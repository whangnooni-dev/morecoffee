/*
 * PRD 인수 기준(AC-01 ~ AC-13) 자동 점검 스크립트.
 * 앱 자체에는 의존성이 없으며, 이 스크립트만 Playwright를 사용한다.
 *
 *   python3 -m http.server 8765        # 저장소 루트에서
 *   BASE_URL=http://localhost:8765/ node tests/acceptance.cjs
 */
const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8765/';
const KEY = 'small-spend-simulator:v1';
let failures = 0;

function check(id, cond, detail) {
  if (cond) console.log(`  ✅ ${id}`);
  else { failures++; console.log(`  ❌ ${id} — ${detail || ''}`); }
}
const text = (page, sel) => page.locator(sel).first().innerText();
const settle = (page) => page.waitForTimeout(450);

async function setRange(page, id, value) {
  await page.evaluate(([id, value]) => {
    const el = document.getElementById(id);
    el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, [id, value]);
}

async function freshPage(browser, opts = {}) {
  const context = await browser.newContext(opts.context || {});
  if (opts.init) await context.addInitScript(opts.init);
  const page = await context.newPage();
  const errors = [];
  const external = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('request', (r) => { if (!r.url().startsWith(BASE_URL) && !r.url().startsWith('data:')) external.push(r.url()); });
  await page.goto(BASE_URL);
  return { context, page, errors, external };
}

(async () => {
  const browser = await chromium.launch();

  console.log('AC-01 ~ AC-04 기본값');
  {
    const { context, page, errors, external } = await freshPage(browser);
    await settle(page);
    check('AC-01 현재 연간 지출', (await text(page, '#current-amount')) === '1,300,000원');
    check('AC-01 절약액', (await text(page, '#saving-amount')) === '520,000원');
    check('AC-01 조절 후', (await text(page, '#after-amount')) === '780,000원');
    check('AC-01 절약률', (await text(page, '#saving-rate')) === '절약률 40%');
    check('AC-02 치킨', (await text(page, '#conv-chicken-value')) === '약 20.8마리');
    check('AC-02 커피', (await text(page, '#conv-coffee-value')) === '약 104잔');
    check('AC-02 여행', (await text(page, '#conv-travel-value')) === '약 1회분');
    check('AC-02 기준 가격 표시', (await text(page, '#conv-chicken-formula')).includes('25,000원'));

    await page.click('#tab-delivery'); await settle(page);
    check('AC-03 배달 현재', (await text(page, '#current-amount')) === '2,400,000원');
    check('AC-03 배달 절약', (await text(page, '#saving-amount')) === '600,000원');
    check('AC-03 배달 조절 후', (await text(page, '#after-amount')) === '1,800,000원');

    await page.click('#tab-subscription'); await settle(page);
    check('AC-04 구독 현재', (await text(page, '#current-amount')) === '180,000원');
    check('AC-04 구독 절약', (await text(page, '#saving-amount')) === '45,000원');
    check('AC-04 구독 조절 후', (await text(page, '#after-amount')) === '135,000원');
    check('AC-04 구독 문구', (await text(page, '#message-text')).includes('잠깐 쉬어가는 구독'));

    console.log('AC-05 ~ AC-07 조작');
    await page.click('#tab-coffee');
    await page.focus('#coffee-weeklyCount');
    await page.keyboard.press('ArrowRight'); // 6회
    await settle(page);
    check('AC-05 키보드 조작 즉시 반영', (await text(page, '#current-amount')) === '1,560,000원');
    const w = await page.evaluate(() => getComputedStyle(document.getElementById('bar-after')).transform);
    check('AC-05 막대가 값과 일치', w.startsWith('matrix(0.666'), w);

    await setRange(page, 'coffee-weeklyCount', 1); await settle(page);
    check('AC-06 줄일 횟수 자동 제한', (await page.inputValue('#coffee-reduceCount')) === '1');
    check('AC-06 절약액 ≤ 현재 지출', (await text(page, '#saving-amount')) === '260,000원' && (await text(page, '#after-amount')) === '0원');

    await setRange(page, 'coffee-weeklyCount', 0); await settle(page);
    const disabled = await page.isDisabled('#coffee-reduceCount');
    const body = await page.innerText('body');
    check('AC-07 현재 0 → 줄일 횟수 비활성', disabled);
    check('AC-07 0 처리, NaN·Infinity·음수 없음', (await text(page, '#saving-amount')) === '0원' && !/NaN|Infinity|-\d/.test(body));
    check('AC-07 0일 때 환산 0', (await text(page, '#conv-chicken-value')) === '0마리');
    check('AC-07 0일 때 문구', (await text(page, '#message-text')).startsWith('지금의 즐거움을 선택해도'));

    console.log('AC-08 복원');
    await setRange(page, 'coffee-weeklyCount', 10);
    await setRange(page, 'coffee-reduceCount', 3);
    await page.click('#tab-delivery');
    await setRange(page, 'delivery-unitPrice', 30000);
    await page.click('.chip[data-conv="travel"][data-price="300000"]');
    // 디바운스 대기 없이 input 이벤트만 보낸 직후 새로고침
    await page.evaluate(() => {
      const el = document.getElementById('delivery-monthlyCount');
      el.value = '9';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.reload(); await settle(page);
    check('AC-08 마지막 탭 복원', (await page.getAttribute('#tab-delivery', 'aria-selected')) === 'true');
    check('AC-08 배달 값 복원(조작 직후 새로고침)', (await page.inputValue('#delivery-unitPrice')) === '30000' && (await page.inputValue('#delivery-monthlyCount')) === '9');
    check('AC-08 커피 값 유지', (await page.inputValue('#coffee-weeklyCount')) === '10' && (await page.inputValue('#coffee-reduceCount')) === '3');
    check('AC-08 환산 기준 복원', (await page.getAttribute('.chip[data-conv="travel"][data-price="300000"]', 'aria-pressed')) === 'true');

    console.log('AC-11 초기화');
    await page.evaluate(() => localStorage.setItem('other-app', 'keep'));
    await page.click('#reset-btn');
    await page.click('#reset-dialog button[value="cancel"]');
    check('AC-11 취소 시 유지', (await page.inputValue('#delivery-unitPrice')) === '30000');
    await page.click('#reset-btn');
    await page.click('#reset-dialog button[value="confirm"]'); await settle(page);
    const stored = await page.evaluate((k) => [localStorage.getItem(k), localStorage.getItem('other-app')], KEY);
    check('AC-11 확인 시 기본값', (await page.getAttribute('#tab-coffee', 'aria-selected')) === 'true' && (await text(page, '#saving-amount')) === '520,000원');
    check('AC-11 앱 키만 제거, 다른 키 유지', stored[0] === null && stored[1] === 'keep', JSON.stringify(stored));

    console.log('AC-13 연속 조작 / 외부 요청 / 콘솔');
    for (let i = 0; i <= 21; i++) await page.evaluate((v) => {
      const el = document.getElementById('coffee-weeklyCount'); el.value = String(v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, i);
    await settle(page);
    check('AC-13 최종값 수렴', (await text(page, '#current-amount')) === '5,460,000원');
    check('AC-13 외부 요청 없음', external.length === 0, external.join(', '));
    check('AC-13 콘솔 오류 없음', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  console.log('AC-09 손상 데이터');
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE_URL);
    await page.evaluate((k) => localStorage.setItem(k, '{broken'), KEY);
    await page.reload(); await settle(page);
    check('AC-09 파싱 불가 → 기본값 + 안내', (await text(page, '#saving-amount')) === '520,000원' && await page.isVisible('#notice'));
    await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({
      schemaVersion: 1, activeCategory: 'pizza',
      coffee: { unitPrice: 5200, weeklyCount: '7', reduceCount: 99 },
      delivery: { unitPrice: 1e9, monthlyCount: -3, reduceCount: null },
      subscription: { monthlyPrice: 15400, skipMonths: 7.6 },
      conversionPrices: { chicken: 26000, coffee: 7000, travel: 'x' }
    })), KEY);
    await page.reload(); await settle(page);
    const v = await page.evaluate(() => ['coffee-unitPrice', 'coffee-weeklyCount', 'coffee-reduceCount', 'delivery-unitPrice', 'delivery-monthlyCount', 'delivery-reduceCount', 'subscription-monthlyPrice', 'subscription-skipMonths'].map((id) => document.getElementById(id).value).join(','));
    check('AC-09 필드별 복구', v === '5000,5,5,100000,0,0,15000,8', v);
    check('AC-09 잘못된 카테고리 → 커피', (await page.getAttribute('#tab-coffee', 'aria-selected')) === 'true');
    check('AC-09 환산 기준 복구', (await page.getAttribute('.chip[data-conv="chicken"][data-price="25000"]', 'aria-pressed')) === 'true' && (await page.getAttribute('.chip[data-conv="coffee"][data-price="7000"]', 'aria-pressed')) === 'true');
    await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ schemaVersion: 2 })), KEY);
    await page.reload(); await settle(page);
    check('AC-09 미지원 schemaVersion → 안내', await page.isVisible('#notice'));
    await setRange(page, 'coffee-unitPrice', 6000);
    const saved = JSON.parse(await page.evaluate((k) => localStorage.getItem(k), KEY));
    check('AC-09 다음 변경 때 정상 형식 저장', saved.schemaVersion === 1 && saved.coffee.unitPrice === 6000);
    await ctx.close();
  }

  console.log('AC-10 저장 차단');
  {
    const { context, page, errors } = await freshPage(browser, {
      init: () => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } })
    });
    await settle(page);
    check('AC-10 계산 동작', (await text(page, '#saving-amount')) === '520,000원');
    await setRange(page, 'coffee-reduceCount', 3); await settle(page);
    check('AC-10 조작 반영', (await text(page, '#saving-amount')) === '780,000원');
    check('AC-10 저장 불가 안내', (await text(page, '#save-status')).includes('저장할 수 없어요'));
    check('AC-10 콘솔 오류 없음', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  console.log('AC-12 360px · 모션 감소');
  {
    const { context, page } = await freshPage(browser, { context: { viewport: { width: 360, height: 740 }, reducedMotion: 'reduce' } });
    await settle(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check('AC-12 가로 스크롤 없음', !overflow);
    for (const cat of ['coffee', 'delivery', 'subscription']) {
      await page.click(`#tab-${cat}`);
      await page.evaluate(() => document.querySelectorAll('.panel:not([hidden]) input[type=range]').forEach((el) => {
        el.value = el.max; el.dispatchEvent(new Event('input', { bubbles: true }));
      }));
      const o = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      check(`AC-12 ${cat} 최대값에서도 잘림 없음`, !o);
    }
    const small = await page.evaluate(() => [...document.querySelectorAll('button, input[type=range]')]
      .filter((el) => el.offsetParent && !el.classList.contains('sr-only'))
      .map((el) => el.getBoundingClientRect()).filter((r) => r.width < 44 || r.height < 44).length);
    check('AC-12 터치 영역 44px 이상', small === 0, `${small}개 작음`);
    const transition = await page.evaluate(() => getComputedStyle(document.getElementById('bar-after')).transitionDuration);
    check('AC-12 모션 감소 반영', transition === '0s', transition);
    await page.click('#tab-coffee');
    await page.keyboard.press('ArrowRight');
    check('AC-12 탭 키보드 이동', (await page.evaluate(() => document.activeElement.id)) === 'tab-delivery');
    await page.screenshot({ path: process.env.SHOT || '/tmp/mobile.png', fullPage: true });
    await context.close();
  }

  await browser.close();
  console.log(failures === 0 ? '\n모든 점검 통과 🎉' : `\n실패 ${failures}건`);
  process.exit(failures ? 1 : 0);
})();
