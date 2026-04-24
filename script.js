// ==UserScript==
// @name         Triburile.ro - MK Exchange TURBO
// @namespace    http://tampermonkey.net/
// @version      4.0
// @author       Marrcky
// @description  Refresh la 2-3s pana apare stoc, cumpara MAX instant, Enter x3
// @match        https://*.triburile.ro/game.php*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // ─── CONFIGURARE ────────────────────────────────────────
    let RESURSE_ACTIVE = { wood: true, stone: true, iron: true };

    let REFRESH_MIN = 2;  // secunde
    let REFRESH_MAX = 3;  // secunde
    let MIN_STOC = 100;     // minim stoc pentru cumparare

    const ENTER_APASARI       = 3;
    const DELAY_INTRE_ENTER   = 500;
    const DELAY_DUPA_BUY_CLICK = 500;
    const DELAY_POST_BUY      = 250;
    // ────────────────────────────────────────────────────────

    const params     = new URLSearchParams(window.location.search);
    const village    = params.get('village');
    const peExchange = params.get('screen') === 'market' && params.get('mode') === 'exchange';

    let ocupat       = false;
    let scriptActiv  = true;
    let buyCnt       = 0;
    let refreshCnt   = 0;
    let sesiuneStart = Date.now();
    let refreshTimer = null;
    let countdownEnd = 0;
    let countdownIv  = null;

    const logLines = [];
    const log = (...args) => {
        console.debug('[turbo]', ...args);
        const msg = args.join(' ');
        logLines.push({ time: Date.now(), msg });
        if (logLines.length > 100) logLines.shift();
        actualizareLog();
    };

    const delay  = (ms) => new Promise(r => setTimeout(r, ms));
    const delayR = (min, max) => delay(Math.floor(Math.random() * (max - min + 1)) + min);

    // ─── CITIRE STOC ─────────────────────────────────────────
    function citesteStoc(r) {
        return parseInt(document.getElementById(`premium_exchange_stock_${r}`)?.textContent?.trim().replace(/\./g, '') || '0');
    }

    function getResurseActive() {
        return Object.keys(RESURSE_ACTIVE).filter(r => RESURSE_ACTIVE[r]);
    }

    function existaStoc() {
        return getResurseActive().some(r => citesteStoc(r) >= MIN_STOC);
    }

    // ─── REFRESH LOOP ─────────────────────────────────────────
    function pornestRefreshLoop() {
        clearTimeout(refreshTimer);
        if (!scriptActiv) return;

        const sec = Math.floor(Math.random() * (REFRESH_MAX - REFRESH_MIN + 1)) + REFRESH_MIN;
        log(`Stoc gol — refresh in ${sec}s.`);
        setStare('waiting', `refresh in ${sec}s`);
        pornestCountdown(sec);

        refreshTimer = setTimeout(() => {
            if (!scriptActiv) return;
            if (existaStoc()) {
                log('Stoc aparut inainte de refresh — cumpar!');
                declanseaza();
                return;
            }
            refreshCnt++;
            actualizareUI();
            log(`Refresh #${refreshCnt}.`);
            location.reload();
        }, sec * 1000);
    }

    function anuleazaRefresh() {
        clearTimeout(refreshTimer);
        refreshTimer = null;
        clearInterval(countdownIv);
    }

    function pornestCountdown(sec) {
        clearInterval(countdownIv);
        countdownEnd = Date.now() + sec * 1000;
        countdownIv = setInterval(() => {
            const ramas = Math.max(0, Math.ceil((countdownEnd - Date.now()) / 1000));
            const cd = document.getElementById('t-countdown');
            if (cd) cd.textContent = `refresh in ${ramas}s`;
            if (ramas === 0) clearInterval(countdownIv);
        }, 200);
    }

    // ─── CLICK ───────────────────────────────────────────────
    function click(el) {
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, buttons: 1 }));
        el.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, button: 0, buttons: 0 }));
        el.dispatchEvent(new MouseEvent('click',     { bubbles: true, button: 0 }));
    }

    function apasaEnter() {
        const ev = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true });
        document.dispatchEvent(ev);
        document.body.dispatchEvent(ev);
        const da = document.querySelector('button.evt-confirm-btn.btn-confirm-yes, .confirmation-box button');
        if (da) click(da);
    }

    async function bombardeazaEnter(de = ENTER_APASARI) {
        for (let i = 0; i < de; i++) {
            apasaEnter();
            await delay(DELAY_INTRE_ENTER);
        }
    }

    // ─── SETEAZA INPUT ────────────────────────────────────────
    function seteazaInput(input, val) {
        input.focus();
        input.value = String(val);
        input.dispatchEvent(new Event('input',  { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.blur();
    }

    // ─── ASTEAPTA BUTON BUY ──────────────────────────────────
    function asteaptaButon(ms = 4000) {
        return new Promise(res => {
            const t0 = Date.now();
            const iv = setInterval(() => {
                const b = document.querySelector('.btn-premium-exchange-buy');
                if (!b) { clearInterval(iv); res(null); return; }
                const dis = b.disabled || b.classList.contains('btn-disabled');
                const txt = b.value || b.textContent || '';
                const cd  = txt.includes('așteptați') || txt.includes('asteptati');
                if (!dis && !cd) { clearInterval(iv); res(b); return; }
                if (Date.now() - t0 > ms) { clearInterval(iv); res(null); }
            }, 80);
        });
    }

    // ─── VIZIBILITATE ────────────────────────────────────────
    function esteVizibil(el) {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return false;
        const s = window.getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
    }

    function areEroareStoc() {
        const texte = ['nu are suficient', 'schimbul nu are', 'insufficient'];
        for (const el of document.querySelectorAll('.confirmation-box, #fader, .premium-exchange-dialog')) {
            if (!esteVizibil(el)) continue;
            if (texte.some(t => (el.textContent || '').toLowerCase().includes(t))) return true;
        }
        return false;
    }

    function asteaptaFereastra(ms = 4000) {
        return new Promise(res => {
            function gaseste() {
                if (areEroareStoc()) return { tip: 'eroare' };
                const da = document.querySelector('button.evt-confirm-btn.btn-confirm-yes');
                if (esteVizibil(da)) return { tip: 'da', el: da };
                const nu = document.querySelector('button.evt-cancel-btn.btn-confirm-no');
                if (esteVizibil(nu)) return { tip: 'nu', el: nu };
                const box = [...document.querySelectorAll('.confirmation-box .confirmation-buttons button, #premium_exchange .confirmation-buttons button')].find(esteVizibil);
                if (box) return { tip: 'box', el: box };
                const fader = [...document.querySelectorAll('#fader button, #fader a.btn')].find(esteVizibil);
                if (fader) return { tip: 'fader', el: fader };
                return null;
            }

            const imediat = gaseste();
            if (imediat) { res(imediat); return; }

            const obs = new MutationObserver(() => {
                const g = gaseste();
                if (g) { obs.disconnect(); res(g); }
            });
            obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
            setTimeout(() => { obs.disconnect(); res(null); }, ms);
        });
    }

    // ─── CUMPARARE RESURSA ────────────────────────────────────
    async function cumpara(resursa) {
        const stoc = citesteStoc(resursa);
        if (stoc < MIN_STOC) return false;

        document.querySelectorAll('input.premium-exchange-input[data-type="buy"]').forEach(i => {
            i.value = '';
            i.dispatchEvent(new Event('input', { bubbles: true }));
        });

        const input = document.querySelector(`input[name="buy_${resursa}"]`);
        if (!input || input.disabled) { log(`${resursa}: input indisponibil.`); return false; }

        log(`${resursa}: cumpar TOT = ${stoc}`);
        seteazaInput(input, stoc);

        const buton = await asteaptaButon(3000);
        if (!buton) { log(`${resursa}: buton indisponibil.`); return false; }

        click(buton);

        await delay(DELAY_DUPA_BUY_CLICK);
        await bombardeazaEnter();

        const fereastra = await asteaptaFereastra(3000);

        if (fereastra) {
            if (fereastra.tip === 'eroare') {
                log(`${resursa}: eroare stoc — refresh.`);
                await delay(200);
                location.reload();
                return false;
            }
            if (fereastra.el) click(fereastra.el);
            await bombardeazaEnter();
            log(`${resursa}: confirmat dublu!`);
        } else {
            log(`${resursa}: confirmat (pre-enter).`);
        }

        buyCnt++;
        actualizareUI();
        afiseazaNotificare(resursa, stoc);

        return true;
    }

    // ─── CICLU PRINCIPAL ─────────────────────────────────────
    async function ruleazaCiclu() {
        if (!scriptActiv) return;

        const captcha = document.querySelector('.bot-check, .captcha, [class*="captcha"], [id*="captcha"]');
        if (captcha && captcha.offsetParent !== null) {
            log('CAPTCHA! Script oprit.');
            scriptActiv = false;
            actualizeazaStatus();
            return;
        }

        if (!existaStoc()) {
            pornestRefreshLoop();
            return;
        }

        anuleazaRefresh();
        setStare('buying', 'cumparare activa...');

        const resurse = getResurseActive()
            .map(r => ({ r, stoc: citesteStoc(r) }))
            .filter(x => x.stoc >= MIN_STOC)
            .sort((a, b) => b.stoc - a.stoc);

        for (const { r } of resurse) {
            if (!scriptActiv) break;
            const ok = await cumpara(r);
            if (!ok) continue;
            await delay(DELAY_POST_BUY);
            await asteaptaButon(2000);
        }

        log('Ciclu complet.');

        if (existaStoc()) {
            await delay(150);
            await ruleazaCiclu();
        } else {
            pornestRefreshLoop();
        }
    }

    async function declanseaza() {
        if (!scriptActiv || ocupat) return;
        ocupat = true;
        await ruleazaCiclu();
        ocupat = false;
    }

    // ─── OBSERVER INSTANT ────────────────────────────────────
    function pornestObserver() {
        getResurseActive().forEach(r => {
            const el = document.getElementById(`premium_exchange_stock_${r}`);
            if (!el) return;
            new MutationObserver(async () => {
                if (!scriptActiv || ocupat) return;
                if (citesteStoc(r) < MIN_STOC) return;
                log(`Stoc nou: ${r} = ${citesteStoc(r)} — cumpar instant!`);
                anuleazaRefresh();
                await declanseaza();
            }).observe(el, { childList: true, subtree: true, characterData: true });
        });

        setInterval(async () => {
            if (!scriptActiv || ocupat || !existaStoc()) return;
            anuleazaRefresh();
            await declanseaza();
        }, 800);
    }

    // ─── NOTIFICARI ──────────────────────────────────────────
    function afiseazaNotificare(r, cant) {
        const nume = { wood: 'Lemn', stone: 'Argila', iron: 'Fier' };
        const n = document.createElement('div');
        n.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:9999999;
            background:#030d03;border-left:2px solid #22c55e;border:1px solid #14532d;
            padding:8px 14px;font-family:'Courier New',monospace;font-size:11px;
            color:#4ade80;letter-spacing:1px;border-radius:3px;
            transition:opacity 0.4s;opacity:1;pointer-events:none;`;
        n.textContent = `> BUY: ${nume[r]} x${cant}`;
        document.body.appendChild(n);
        setTimeout(() => { n.style.opacity = '0'; setTimeout(() => n.remove(), 400); }, 2500);
    }

    // ─── UI HELPERS ───────────────────────────────────────────
    function setStare(tip, msg) {
        const bar = document.getElementById('t-state-bar');
        const txt = document.getElementById('t-state-txt');
        const cd  = document.getElementById('t-countdown');
        if (bar) bar.className = tip === 'waiting' ? 't-status-bar waiting' : 't-status-bar';
        if (txt) txt.textContent = `> ${msg}`;
        if (cd && tip !== 'waiting') cd.textContent = '';
    }

    function actualizareUI() {
        ['mk-buy-cnt', 'mk-buy-footer'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = buyCnt;
        });
        const rc = document.getElementById('t-ref-cnt');
        if (rc) rc.textContent = refreshCnt;
    }

    function actualizeazaStatus() {
        const dot = document.getElementById('t-dot');
        const txt = document.getElementById('t-status-txt');
        const btn = document.getElementById('mkt-btn');
        if (dot) { dot.style.background = scriptActiv ? '#22c55e' : '#ef4444'; dot.style.animation = scriptActiv ? '' : 'none'; }
        if (txt) txt.textContent = scriptActiv ? 'ACTIV' : 'OPRIT';
        if (btn) { btn.textContent = scriptActiv ? '[TURBO]' : '[OPRIT]'; btn.style.color = scriptActiv ? '#22c55e' : '#f87171'; btn.style.borderColor = scriptActiv ? '#166534' : '#7f1d1d'; }
    }

    function togglePanou(s) {
        const o = document.getElementById('mkt-overlay');
        if (!o) return;
        const open = s !== undefined ? s : !o.classList.contains('open');
        o.classList.toggle('open', open);
    }

    function actualizareLog() {
        const box = document.getElementById('t-log-box');
        if (!box) return;
        box.innerHTML = logLines.map(l => {
            const d = new Date(l.time - sesiuneStart);
            const t = `${String(Math.floor(d/60000)).padStart(2,'0')}:${String(Math.floor((d%60000)/1000)).padStart(2,'0')}`;
            const c = l.msg.includes('cumpar') || l.msg.includes('confirmat') ? 'ok'
                    : l.msg.includes('refresh') || l.msg.includes('Refresh') || l.msg.includes('gol') || l.msg.includes('Enter') ? 'warn'
                    : l.msg.includes('OPRIT') || l.msg.includes('CAPTCHA') || l.msg.includes('eroare') ? 'err' : '';
            return `<div class="t-log-entry"><span class="t-log-time">${t}</span><span class="t-log-msg ${c}">${l.msg}</span></div>`;
        }).join('');
        box.scrollTop = box.scrollHeight;
    }

    // ─── PANOU ───────────────────────────────────────────────
    function creeazaPanou() {
        const s = document.createElement('style');
        s.textContent = `
            #mkt-btn{position:fixed;bottom:20px;left:20px;z-index:999999;background:#030d03;border:1px solid #166534;color:#22c55e;font-family:'Courier New',monospace;font-size:10px;letter-spacing:2px;padding:6px 12px;cursor:pointer;border-radius:2px;transition:.2s;user-select:none}
            #mkt-btn:hover{background:#031a03;border-color:#22c55e}
            #mkt-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.65);display:flex;align-items:center;justify-content:center;z-index:999998;opacity:0;pointer-events:none;transition:opacity 0.2s}
            #mkt-overlay.open{opacity:1;pointer-events:all}
            #mkt-panel{background:#050505;border:1px solid #1a1a1a;border-radius:4px;width:340px;max-width:95vw;font-family:'Courier New',monospace;color:#e2e8f0;position:relative;overflow:hidden;transform:translateY(12px) scale(0.97);transition:transform 0.2s}
            #mkt-overlay.open #mkt-panel{transform:translateY(0) scale(1)}
            #mkt-panel::before{content:'';position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,255,0,0.012) 2px,rgba(0,255,0,0.012) 4px);pointer-events:none;z-index:0}
            .t-hdr{background:#030303;padding:8px 12px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #1a1a1a;position:relative;z-index:1}
            .t-title{font-size:10px;color:#22c55e;letter-spacing:3px}
            .t-pill{display:flex;align-items:center;gap:5px;font-size:8px;color:#4ade80;letter-spacing:1px}
            .t-dot{width:5px;height:5px;border-radius:50%;background:#22c55e;animation:t-blink 0.8s infinite}
            @keyframes t-blink{0%,100%{opacity:1}50%{opacity:0.1}}
            .t-close{background:none;border:none;color:#2a2a2a;cursor:pointer;font-size:14px;font-family:'Courier New',monospace;transition:color .15s}
            .t-close:hover{color:#ef4444}
            .t-body{padding:12px 14px;position:relative;z-index:1;display:flex;flex-direction:column;gap:10px}
            .t-sep{border:none;border-top:1px solid #111;margin:0}
            .t-sect{font-size:8px;color:#222;letter-spacing:2px;margin-bottom:6px}
            .t-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}
            .t-lbl{font-size:9px;color:#1c3a1c;letter-spacing:1px}
            .t-val{font-size:10px;color:#4ade80}
            .t-res-row{display:flex;gap:14px}
            .t-rc{display:flex;align-items:center;gap:5px;cursor:pointer}
            .t-rc input{display:none}
            .t-rb{width:13px;height:13px;border:1px solid #1f1f1f;border-radius:1px;display:flex;align-items:center;justify-content:font-size:8px;color:transparent;transition:.15s;background:#0a0a0a}
            .t-rc input:checked ~ .t-rb{color:#4ade80;background:#031a03;border-color:#166534}
            .t-rl{font-size:10px;color:#2a2a2a;letter-spacing:1px;transition:.15s}
            .t-rc input:checked ~ .t-rl{color:#4ade80}
            .t-sl-row{display:flex;align-items:center;gap:8px;margin-bottom:5px}
            .t-sl-lbl{font-size:9px;color:#1c3a1c;letter-spacing:1px;width:85px;flex-shrink:0}
            .t-sl-val{font-size:10px;color:#22c55e;width:36px;text-align:right;flex-shrink:0}
            .t-range{flex:1;-webkit-appearance:none;height:2px;background:#141414;outline:none;cursor:pointer}
            .t-range::-webkit-slider-thumb{-webkit-appearance:none;width:9px;height:9px;border-radius:50%;background:#22c55e;cursor:pointer}
            .t-status-bar{padding:5px 9px;background:#030d03;border-left:2px solid #22c55e;font-size:9px;color:#4ade80;display:flex;align-items:center;justify-content:space-between}
            .t-status-bar.waiting{border-left-color:#f59e0b;color:#f59e0b}
            .t-cmd-row{display:flex;gap:5px}
            .t-cmd{flex:1;padding:7px 0;background:#0a0a0a;border:1px solid #1a1a1a;font-family:'Courier New',monospace;font-size:9px;letter-spacing:1px;cursor:pointer;border-radius:2px;transition:.18s;font-weight:700}
            .t-cmd.run{color:#4ade80;border-color:#14532d}
            .t-cmd.run:hover{background:#031a03;border-color:#22c55e;color:#86efac}
            .t-cmd.stop{color:#f87171;border-color:#7f1d1d}
            .t-cmd.stop:hover{background:#1a0505;border-color:#ef4444;color:#fca5a5}
            .t-cmd:active{transform:scale(0.97)}
            .t-log{background:#030303;border:1px solid #111;border-radius:2px;padding:7px 9px;height:100px;overflow-y:auto;font-size:9px;display:flex;flex-direction:column;gap:2px}
            .t-log-entry{display:flex;gap:7px}
            .t-log-time{color:#1a1a1a;min-width:42px;flex-shrink:0}
            .t-log-msg{color:#2a2a2a;word-break:break-all}
            .t-log-msg.ok{color:#22c55e}
            .t-log-msg.warn{color:#f59e0b}
            .t-log-msg.err{color:#ef4444}
            .t-footer{display:flex;justify-content:space-between;padding:5px 14px;border-top:1px solid #111;position:relative;z-index:1}
            .t-ft{font-size:8px;color:#1a1a1a;letter-spacing:1px}
            .t-ft-accent{color:#22c55e}
        `;
        document.head.appendChild(s);

        const btn = document.createElement('button');
        btn.id = 'mkt-btn';
        btn.textContent = '[TURBO]';
        btn.onclick = () => togglePanou();
        document.body.appendChild(btn);

        const overlay = document.createElement('div');
        overlay.id = 'mkt-overlay';
        overlay.innerHTML = `
            <div id="mkt-panel">
                <div class="t-hdr">
                    <span class="t-title">[ MK_TURBO ]</span>
                    <div style="display:flex;align-items:center;gap:8px">
                        <div class="t-pill"><div class="t-dot" id="t-dot"></div><span id="t-status-txt">ACTIV</span></div>
                        <span style="font-size:8px;color:#333;background:#0a0a0a;border:1px solid #1a1a1a;border-radius:2px;padding:1px 5px;letter-spacing:1px">CTRL+M</span>
                        <button class="t-close" id="t-close">[X]</button>
                    </div>
                </div>
                <div class="t-body">
                    <div style="display:flex;justify-content:space-between;font-size:9px;color:#2a2a2a;letter-spacing:1px">
                        <span>> uptime: <span style="color:#22c55e" id="t-up">0s</span></span>
                        <span id="t-clock" style="color:#1a1a1a">--:--:--</span>
                    </div>
                    <hr class="t-sep">
                    <div>
                        <div class="t-sect">// STATISTICI</div>
                        <div class="t-row"><span class="t-lbl">CUMPARARI</span><span class="t-val" id="mk-buy-cnt">0</span></div>
                        <div class="t-row"><span class="t-lbl">REFRESH-URI</span><span class="t-val" id="t-ref-cnt">0</span></div>
                    </div>
                    <hr class="t-sep">
                    <div>
                        <div class="t-sect">// RESURSE ACTIVE</div>
                        <div class="t-res-row">
                            <label class="t-rc"><input type="checkbox" id="tr-wood" checked><div class="t-rb">✓</div><span class="t-rl">LEMN</span></label>
                            <label class="t-rc"><input type="checkbox" id="tr-stone" checked><div class="t-rb">✓</div><span class="t-rl">ARGILA</span></label>
                            <label class="t-rc"><input type="checkbox" id="tr-iron" checked><div class="t-rb">✓</div><span class="t-rl">FIER</span></label>
                        </div>
                    </div>
                    <hr class="t-sep">
                    <div>
                        <div class="t-sect">// PARAMETRI REFRESH</div>
                        <div class="t-sl-row">
                            <span class="t-sl-lbl">REFRESH_MIN</span>
                            <input type="range" class="t-range" min="1" max="30" value="2" step="1" id="t-sl-rmin">
                            <span class="t-sl-val" id="t-sl-rmin-val">2s</span>
                        </div>
                        <div class="t-sl-row">
                            <span class="t-sl-lbl">REFRESH_MAX</span>
                            <input type="range" class="t-range" min="2" max="60" value="3" step="1" id="t-sl-rmax">
                            <span class="t-sl-val" id="t-sl-rmax-val">3s</span>
                        </div>
                        <div class="t-sl-row">
                            <span class="t-sl-lbl">MIN_STOC</span>
                            <input type="range" class="t-range" min="1" max="5000" value="1" step="1" id="t-sl-minstoc">
                            <span class="t-sl-val" id="t-sl-minstoc-val">1</span>
                        </div>
                    </div>
                    <hr class="t-sep">
                    <div class="t-status-bar" id="t-state-bar">
                        <span id="t-state-txt">> initializare...</span>
                        <span id="t-countdown" style="font-size:8px;opacity:0.7"></span>
                    </div>
                    <div class="t-cmd-row">
                        <button class="t-cmd run" id="t-btn-run">[RUN NOW]</button>
                        <button class="t-cmd stop" id="t-btn-stop">[STOP]</button>
                    </div>
                    <div>
                        <div class="t-sect">// LOG</div>
                        <div class="t-log" id="t-log-box"></div>
                    </div>
                </div>
                <div class="t-footer">
                    <span class="t-ft">by <span class="t-ft-accent">Marrcky</span> _ turbo v4.0</span>
                    <span class="t-ft">buy: <span class="t-ft-accent" id="mk-buy-footer">0</span></span>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        document.getElementById('t-close').onclick = () => togglePanou(false);
        overlay.addEventListener('click', e => { if (e.target === overlay) togglePanou(false); });

        ['wood', 'stone', 'iron'].forEach(r => {
            document.getElementById(`tr-${r}`).addEventListener('change', e => {
                RESURSE_ACTIVE[r] = e.target.checked;
                log(`${r}: ${e.target.checked ? 'activa' : 'dezactivata'}.`);
            });
        });

        document.getElementById('t-sl-rmin').addEventListener('input', e => {
            REFRESH_MIN = parseInt(e.target.value);
            document.getElementById('t-sl-rmin-val').textContent = e.target.value + 's';
        });

        document.getElementById('t-sl-rmax').addEventListener('input', e => {
            REFRESH_MAX = parseInt(e.target.value);
            document.getElementById('t-sl-rmax-val').textContent = e.target.value + 's';
        });

        document.getElementById('t-sl-minstoc').addEventListener('input', e => {
            MIN_STOC = parseInt(e.target.value);
            document.getElementById('t-sl-minstoc-val').textContent = e.target.value;
        });

        document.getElementById('t-btn-run').onclick = async () => {
            if (!scriptActiv) { log('Script oprit.'); return; }
            log('Run manual.');
            await declanseaza();
        };

        document.getElementById('t-btn-stop').onclick = () => {
            scriptActiv = false;
            anuleazaRefresh();
            actualizeazaStatus();
            log('Script OPRIT.');
        };

        setInterval(() => {
            const sec = Math.floor((Date.now() - sesiuneStart) / 1000);
            const up = document.getElementById('t-up');
            if (up) up.textContent = sec < 60 ? sec + 's' : Math.floor(sec/60) + 'm' + String(sec%60).padStart(2,'0') + 's';
            const cl = document.getElementById('t-clock');
            if (cl) cl.textContent = new Date().toTimeString().slice(0,8);
        }, 1000);
    }

    document.addEventListener('keydown', e => {
        if (e.ctrlKey && e.key === 'm') { e.preventDefault(); togglePanou(); }
    });

    // ─── PORNIRE ─────────────────────────────────────────────
    window.addEventListener('load', async () => {
        creeazaPanou();

        if (!peExchange) {
            log('Redirectez pe Exchange...');
            await delayR(200, 400);
            window.location.href = `game.php?village=${village}&screen=market&mode=exchange`;
            return;
        }

        await delayR(150, 300);
        log('MK_TURBO v4.0 pornit. Ctrl+M = panou.');

        if (existaStoc()) {
            await declanseaza();
        } else {
            pornestRefreshLoop();
        }

        pornestObserver();
    });

})();
