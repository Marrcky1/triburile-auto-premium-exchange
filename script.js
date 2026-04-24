// ==UserScript==
// @name         Triburile.ro - Auto Cumpara Premium Exchange
// @namespace    http://tampermonkey.net/
// @version      17.0
// @author       Marrcky
// @description  Cumpara automat resurse echilibrat din depozitul premium
// @match        https://*.triburile.ro/game.php*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // ─── CONFIGURARE DEFAULT ────────────────────────────────
    let MINIM_STOC   = 100;
    let PRAG_MAGAZIE = 0.95;
    let REFRESH_MIN  = 1;
    let REFRESH_MAX  = 3;
    let PAUZA_MIN    = 5;
    let PAUZA_MAX    = 15;
    let SANSA_PAUZA  = 0.15;
    let SANSA_NAVIGA = 0.40;
    let RESURSE_ACTIVE = { wood: true, stone: true, iron: true };
    let VITEZA = 2;
    let BLOCARE_TARG = false;

    const MOD_DETECTIE = 'hybrid';
    const SK_RETURN   = 'mkt_last';
    const SK_TIME     = 'mkt_ts';
    const SK_MOD      = 'mkt_md';
    const SK_SETTINGS = 'mkt_cfg';

    function salveazaSetari() {
        const cfg = { MINIM_STOC, PRAG_MAGAZIE, VITEZA, BLOCARE_TARG, pauzaActivata, RESURSE_ACTIVE: { ...RESURSE_ACTIVE } };
        localStorage.setItem(SK_SETTINGS, JSON.stringify(cfg));
    }

    function incarcaSetari() {
        try {
            const raw = localStorage.getItem(SK_SETTINGS);
            if (!raw) return;
            const cfg = JSON.parse(raw);
            if (cfg.MINIM_STOC    !== undefined) MINIM_STOC    = cfg.MINIM_STOC;
            if (cfg.PRAG_MAGAZIE  !== undefined) PRAG_MAGAZIE  = cfg.PRAG_MAGAZIE;
            if (cfg.VITEZA        !== undefined) VITEZA        = cfg.VITEZA;
            if (cfg.BLOCARE_TARG  !== undefined) BLOCARE_TARG  = cfg.BLOCARE_TARG;
            if (cfg.pauzaActivata !== undefined) pauzaActivata = cfg.pauzaActivata;
            if (cfg.RESURSE_ACTIVE) RESURSE_ACTIVE = { ...RESURSE_ACTIVE, ...cfg.RESURSE_ACTIVE };
        } catch(e) {}
    }

    const params     = new URLSearchParams(window.location.search);
    const village    = params.get('village');
    const peExchange = params.get('screen') === 'market' && params.get('mode') === 'exchange';

    let ocupat        = false;
    let inPauzaLunga  = false;
    let scriptActiv   = true;
    let pauzaActivata = true;
    let sesiuneStart  = Date.now();
    let buyCnt        = 0;
    let pauseCnt      = 0;
    let refreshTimer  = null;
    let pollingInterval = null;

    const logLines = [];
    const log = (...args) => {
        const msg = args.join(' ');
        logLines.push({ time: Date.now(), msg });
        if (logLines.length > 60) logLines.shift();
        actualizareLog();
    };

    function getDelays() {
        const cfg = {
            1: { tastMin: 150, tastMax: 400, umanMin: 4000, umanMax: 10000, umanSlow: 0.4 },
            2: { tastMin: 80,  tastMax: 220, umanMin: 1000, umanMax: 4000,  umanSlow: 0.3 },
            3: { tastMin: 40,  tastMax: 100, umanMin: 500,  umanMax: 2000,  umanSlow: 0.2 },
            4: { tastMin: 10,  tastMax: 40,  umanMin: 100,  umanMax: 500,   umanSlow: 0.05 },
        };
        return cfg[VITEZA] || cfg[2];
    }

    function delayRandom(min, max) {
        return new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min)) + min));
    }

    function delayUman() {
        const d = getDelays();
        if (Math.random() < d.umanSlow) return delayRandom(d.umanMax, d.umanMax * 2.5);
        return delayRandom(d.umanMin, d.umanMax);
    }

    function clickUman(element) {
        const rect = element.getBoundingClientRect();
        const x = rect.left + (rect.width  * (0.3 + Math.random() * 0.4));
        const y = rect.top  + (rect.height * (0.3 + Math.random() * 0.4));
        ['mousemove','mouseover','mouseenter','mousedown','mouseup','click'].forEach(ev => {
            element.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
        });
    }

    async function seteazaInput(input, valoare) {
        const d = getDelays();
        input.focus();
        input.value = '';
        input.dispatchEvent(new Event('focus', { bubbles: true }));
        const str = String(valoare);
        for (let i = 0; i < str.length; i++) {
            const ch = str[i];
            input.value += ch;
            input.dispatchEvent(new KeyboardEvent('keydown',  { key: ch, bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keypress', { key: ch, bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keyup',    { key: ch, bubbles: true }));
            input.dispatchEvent(new Event('input', { bubbles: true }));
            await delayRandom(d.tastMin, d.tastMax);
        }
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.blur();
    }

    function asteaptaInputActiv(input) {
        return new Promise((resolve) => {
            if (!input.disabled) { resolve(true); return; }
            const obs = new MutationObserver(() => {
                if (!input.disabled) { obs.disconnect(); resolve(true); }
            });
            obs.observe(input, { attributes: true, attributeFilter: ['disabled'] });
            setTimeout(() => { obs.disconnect(); resolve(false); }, 3000);
        });
    }

    function citesteResurseSat() {
        return {
            wood:  parseInt(document.querySelector('#wood')?.textContent?.replace(/\./g, '')  || '0'),
            stone: parseInt(document.querySelector('#stone')?.textContent?.replace(/\./g, '') || '0'),
            iron:  parseInt(document.querySelector('#iron')?.textContent?.replace(/\./g, '')  || '0')
        };
    }

    function citesteCapacitateMagazie() {
        return {
            wood:  parseInt(document.getElementById('premium_exchange_capacity_wood')?.textContent?.replace(/\./g, '')  || '99999'),
            stone: parseInt(document.getElementById('premium_exchange_capacity_stone')?.textContent?.replace(/\./g, '') || '99999'),
            iron:  parseInt(document.getElementById('premium_exchange_capacity_iron')?.textContent?.replace(/\./g, '')  || '99999')
        };
    }

    function citesteStocExchange(resursa) {
        const el = document.getElementById(`premium_exchange_stock_${resursa}`);
        if (!el) return 0;
        return parseInt(el.textContent.trim().replace(/\./g, '')) || 0;
    }

    function getResurseActive() {
        return ['wood', 'stone', 'iron'].filter(r => RESURSE_ACTIVE[r]);
    }

    function existaStocSuficient() {
        return getResurseActive().some(r => citesteStocExchange(r) > MINIM_STOC);
    }

    function calculeazaPrioritati() {
        const sat        = citesteResurseSat();
        const capacitate = citesteCapacitateMagazie();
        const procente = {
            wood:  sat.wood  / (capacitate.wood  || 99999),
            stone: sat.stone / (capacitate.stone || 99999),
            iron:  sat.iron  / (capacitate.iron  || 99999)
        };
        const ordine = getResurseActive()
            .filter(r => {
                if (citesteStocExchange(r) <= MINIM_STOC) return false;
                if (procente[r] >= PRAG_MAGAZIE) return false;
                return true;
            })
            .sort((a, b) => procente[a] - procente[b]);
        return { ordine, procente, sat, capacitate };
    }

    function calculeazaCantitate(resursa, stocExchange, sat, capacitate) {
        const spatLiber = Math.floor((capacitate[resursa] || 99999) * PRAG_MAGAZIE) - sat[resursa];
        if (spatLiber <= 0) return 0;
        return Math.floor(Math.min(stocExchange, spatLiber) * (0.80 + Math.random() * 0.20));
    }

    function asteaptaButonActiv() {
        return new Promise((resolve) => {
            const interval = setInterval(() => {
                const buton = document.querySelector('.btn-premium-exchange-buy');
                if (!buton) { clearInterval(interval); resolve(); return; }
                const text = buton.value || buton.textContent || '';
                if (!buton.disabled && !buton.classList.contains('btn-disabled') && !text.includes('așteptați') && !text.includes('asteptati')) {
                    clearInterval(interval); resolve();
                }
            }, 500);
            setTimeout(() => { clearInterval(interval); resolve(); }, 15000);
        });
    }

    function asteaptaConfirmare() {
        return new Promise((resolve) => {
            const handle = async (btn, msg, doRefresh) => {
                if (doRefresh) { await delayRandom(400, 800); location.reload(); resolve(); return; }
                await delayRandom(150, 500);
                clickUman(btn);
                log(msg);
                await delayRandom(400, 700);
                resolve();
            };
            function esteVizibil(el) {
                if (!el) return false;
                const rect = el.getBoundingClientRect();
                if (rect.width === 0 && rect.height === 0) return false;
                const s = window.getComputedStyle(el);
                return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
            }
            function areEroareStoc() {
                const texte = ['Schimbul nu are suficient','nu are suficient','stoc insuficient','insufficient'];
                const elems = document.querySelectorAll('.confirmation-box,#premium_exchange .confirmation-box,.premium-exchange-dialog,#fader');
                for (const el of elems) {
                    if (!esteVizibil(el)) continue;
                    if (texte.some(t => (el.textContent||'').toLowerCase().includes(t.toLowerCase()))) return true;
                }
                return false;
            }
            function gasesteButon() {
                if (areEroareStoc()) return { btn: null, msg: '', doRefresh: true };
                const da = document.querySelector('button.evt-confirm-btn.btn-confirm-yes');
                if (esteVizibil(da)) return { btn: da, msg: 'Confirmare!' };
                const nu = document.querySelector('button.evt-cancel-btn.btn-confirm-no');
                if (esteVizibil(nu)) return { btn: nu, msg: 'Stoc insuf — Intrerupe!' };
                const dinBox = document.querySelectorAll('.confirmation-box .confirmation-buttons button,.confirmation-box .confirmation-buttons a,#premium_exchange .confirmation-buttons button,#premium_exchange .confirmation-buttons a');
                for (const b of dinBox) if (esteVizibil(b)) return { btn: b, msg: `Inchis: "${(b.textContent||'').trim()}"` };
                const dinFader = document.querySelectorAll('#fader button,#fader a.btn,#fader input[type=button]');
                for (const b of dinFader) if (esteVizibil(b)) return { btn: b, msg: `Fader: "${(b.textContent||b.value||'').trim()}"` };
                return null;
            }
            const imediat = gasesteButon();
            if (imediat) { handle(imediat.btn, imediat.msg, imediat.doRefresh); return; }
            const obs = new MutationObserver(async () => {
                const gasit = gasesteButon();
                if (gasit) { obs.disconnect(); await handle(gasit.btn, gasit.msg, gasit.doRefresh); }
            });
            obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style','class'] });
            setTimeout(() => { obs.disconnect(); resolve(); }, 8000);
        });
    }

    async function verificaPauzaLunga() {
        if (!pauzaActivata || BLOCARE_TARG) return;
        if (Math.random() < SANSA_PAUZA) {
            const min = Math.floor(Math.random() * (PAUZA_MAX - PAUZA_MIN)) + PAUZA_MIN;
            log(`Pauza lunga: ${min} min.`);
            pauseCnt++;
            const el = document.getElementById('mk-pause-cnt');
            if (el) el.textContent = pauseCnt;
            inPauzaLunga = true;
            await delayRandom(min * 60 * 1000, min * 60 * 1000 + 30000);
            inPauzaLunga = false;
            log('Pauza terminata.');
        }
    }

    const PAGINI_NATURALE = [
        `game.php?village=${village}&screen=main`,
        `game.php?village=${village}&screen=train`,
        `game.php?village=${village}&screen=overview_villages`,
        `game.php?village=${village}&screen=report`,
    ];
    const URL_EXCHANGE = `game.php?village=${village}&screen=market&mode=exchange`;

    function scheduleRefresh() {
        if (BLOCARE_TARG || !scriptActiv) return;
        const sec = Math.floor(Math.random() * (REFRESH_MAX - REFRESH_MIN)) + REFRESH_MIN;
        if (Math.random() < SANSA_NAVIGA) {
            const pg = PAGINI_NATURALE[Math.floor(Math.random() * PAGINI_NATURALE.length)];
            log(`Navighez intermediar in ${sec}s.`);
            refreshTimer = setTimeout(() => {
                sessionStorage.setItem(SK_RETURN, URL_EXCHANGE);
                sessionStorage.setItem(SK_TIME, Date.now().toString());
                window.location.href = pg;
            }, sec * 1000);
        } else {
            log(`Refresh in ${sec}s.`);
            refreshTimer = setTimeout(() => location.reload(), sec * 1000);
        }
    }

    function verificaRevenire() {
        const returnUrl  = sessionStorage.getItem(SK_RETURN);
        const returnTime = parseInt(sessionStorage.getItem(SK_TIME) || '0');
        if (!returnUrl) return;
        if (peExchange) { sessionStorage.removeItem(SK_RETURN); sessionStorage.removeItem(SK_TIME); return; }
        if (Date.now() - returnTime > 3 * 60 * 1000) { sessionStorage.removeItem(SK_RETURN); sessionStorage.removeItem(SK_TIME); return; }
        const wait = Math.floor(Math.random() * 35000) + 20000;
        setTimeout(() => { window.location.href = returnUrl; }, wait);
    }

    async function ruleazaAutoBuy() {
        if (!scriptActiv) return;
        const captcha = document.querySelector('.bot-check,.captcha,[class*="captcha"],[id*="captcha"]');
        if (captcha && captcha.offsetParent !== null) { log('Captcha detectat!'); return; }
        await verificaPauzaLunga();
        if (inPauzaLunga || !scriptActiv) return;
        const { ordine, procente, sat, capacitate } = calculeazaPrioritati();
        if (ordine.length === 0) { log('Nimic de cumparat.'); return; }
        for (const resursa of ordine) {
            if (!scriptActiv) break;
            const stocEx    = citesteStocExchange(resursa);
            const cantitate = calculeazaCantitate(resursa, stocEx, sat, capacitate);
            if (cantitate <= 0) continue;
            const input = document.querySelector(`input[name="buy_${resursa}"]`);
            if (!input) continue;
            const ok = await asteaptaInputActiv(input);
            if (!ok) continue;
            document.querySelectorAll('input.premium-exchange-input[data-type="buy"]').forEach(i => {
                i.value = '';
                i.dispatchEvent(new Event('input', { bubbles: true }));
            });
            log(`Cumpar ${resursa}: ${cantitate} (stoc=${stocEx}, mag=${(procente[resursa]*100).toFixed(1)}%)`);
            await delayUman();
            await seteazaInput(input, cantitate);
            await delayRandom(300, 700);
            await asteaptaButonActiv();
            const buton = document.querySelector('.btn-premium-exchange-buy');
            if (!buton) continue;
            await delayRandom(200, 500);
            clickUman(buton);
            buyCnt++;
            const elBuy = document.getElementById('mk-buy-cnt');
            if (elBuy) elBuy.textContent = buyCnt;
            afiseazaNotificare(resursa, cantitate);
            await asteaptaConfirmare();
            await delayRandom(600, 1200);
            await asteaptaButonActiv();
        }
        log('Ciclu complet.');
        if (BLOCARE_TARG && scriptActiv) {
            const d = getDelays();
            await delayRandom(d.umanMin, d.umanMax);
            if (!ocupat) { ocupat = true; await ruleazaAutoBuy(); ocupat = false; }
        }
    }

    function pornestObservareStoc() {
        let m = sessionStorage.getItem(SK_MOD);
        if (!m) { m = Math.random() < 0.5 ? 'observer' : 'polling'; sessionStorage.setItem(SK_MOD, m); }
        if (m === 'observer') {
            const obs = new MutationObserver(async () => {
                if (!scriptActiv || ocupat || inPauzaLunga || !existaStocSuficient()) return;
                ocupat = true; await ruleazaAutoBuy(); ocupat = false;
            });
            getResurseActive().forEach(r => {
                const el = document.getElementById(`premium_exchange_stock_${r}`);
                if (el) obs.observe(el, { childList: true, subtree: true, characterData: true });
            });
        } else {
            const prog = () => {
                pollingInterval = setTimeout(async () => {
                    if (scriptActiv && !ocupat && !inPauzaLunga && existaStocSuficient()) {
                        ocupat = true; await ruleazaAutoBuy(); ocupat = false;
                    }
                    prog();
                }, Math.floor(Math.random() * 4000) + 3000);
            };
            prog();
        }
    }

    // ─── NOTIFICARI ──────────────────────────────────────────
    function afiseazaNotificare(resursa, cantitate) {
        const numeLisibil = { wood: 'Lemn', stone: 'Argila', iron: 'Fier' };
        const culori = { wood: '#8B5E3C', stone: '#7a6a50', iron: '#6b7a8d' };
        const notif = document.createElement('div');
        notif.style.cssText = `
            position:fixed;bottom:80px;right:16px;z-index:9999999;
            background:linear-gradient(135deg,#f9eecc,#eedfa0);
            border:1px solid #9a7a2a;border-left:3px solid ${culori[resursa]||'#9a7a2a'};
            padding:8px 14px;font-family:Arial,sans-serif;font-size:12px;
            color:#3a2800;border-radius:6px;
            box-shadow:0 3px 12px rgba(0,0,0,0.3);
            transition:opacity 0.4s;opacity:1;pointer-events:none;
        `;
        notif.textContent = `✓ Cumparat: ${numeLisibil[resursa]} × ${cantitate}`;
        document.body.appendChild(notif);
        setTimeout(() => { notif.style.opacity = '0'; setTimeout(() => notif.remove(), 400); }, 2500);
    }

    // ─── CSS GUI ─────────────────────────────────────────────
    const CSS_PANOU = `
    #mk-float{position:fixed!important;bottom:10px!important;left:10px!important;z-index:2147483646!important;
        background:linear-gradient(90deg,#8a5a10,#c4922a);border:none;border-radius:8px;
        color:#fff;font-family:Arial,sans-serif;font-size:13px;font-weight:bold;
        padding:8px 14px;cursor:pointer;box-shadow:0 3px 12px rgba(0,0,0,.4);
        text-shadow:0 1px 2px rgba(0,0,0,.4);}
    #mk-float:hover{filter:brightness(1.1);}

    #mk-panel{position:fixed!important;bottom:60px!important;left:10px!important;z-index:2147483647!important;
        width:310px;background:linear-gradient(160deg,#f9eecc,#eedfa0);
        border:2px solid #9a7a2a;border-radius:10px;
        box-shadow:0 6px 24px rgba(0,0,0,.45);font-family:Arial,sans-serif;
        font-size:13px;color:#3a2800;display:none;}

    #mk-header{background:linear-gradient(90deg,#8a5a10,#c4922a);border-radius:8px 8px 0 0;
        padding:9px 12px;display:flex;justify-content:space-between;align-items:center;cursor:move;}
    #mk-header-title{font-weight:bold;font-size:14px;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.5);}
    #mk-header-status{font-size:11px;color:rgba(255,255,255,.85);display:flex;align-items:center;gap:6px;}
    .mk-dot{width:7px;height:7px;border-radius:50%;background:#7fff7f;
        animation:mk-pulse 1.4s infinite;flex-shrink:0;}
    .mk-dot.off{background:#ff7f7f;animation:none;}
    @keyframes mk-pulse{0%,100%{opacity:1}50%{opacity:.3}}
    #mk-close{background:rgba(0,0,0,.25);border:none;color:#fff;width:22px;height:22px;
        border-radius:50%;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;}

    #mk-body{padding:10px 12px 10px;display:flex;flex-direction:column;gap:8px;}

    .mk-sect{font-size:10px;font-weight:bold;color:#7a5a10;text-transform:uppercase;
        letter-spacing:.05em;margin-bottom:5px;border-bottom:1px solid #c8a84e;padding-bottom:2px;}

    .mk-stat-row{display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;}
    .mk-stat-lbl{color:#7a5a10;}
    .mk-stat-val{font-weight:bold;color:#3a2800;}

    .mk-res-row{display:flex;gap:8px;margin-bottom:2px;}
    .mk-rc{display:flex;align-items:center;gap:5px;cursor:pointer;font-size:12px;}
    .mk-rc input{display:none;}
    .mk-rb{width:14px;height:14px;border:1px solid #c8a84e;border-radius:3px;
        background:#fdf6e0;display:flex;align-items:center;justify-content:center;
        font-size:9px;color:transparent;transition:.15s;}
    .mk-rc input:checked ~ .mk-rb{background:#c8a84e;color:#3a2800;border-color:#9a7a2a;}
    .mk-rl{color:#5a3a00;transition:.15s;}
    .mk-rc input:checked ~ .mk-rl{color:#3a2800;font-weight:bold;}

    .mk-sl-row{display:flex;align-items:center;gap:8px;margin-bottom:4px;}
    .mk-sl-lbl{font-size:11px;color:#7a5a10;width:80px;flex-shrink:0;}
    .mk-sl-val{font-size:11px;font-weight:bold;color:#3a2800;width:36px;text-align:right;flex-shrink:0;}
    .mk-range{flex:1;-webkit-appearance:none;height:3px;background:#c8a84e;border-radius:2px;outline:none;cursor:pointer;}
    .mk-range::-webkit-slider-thumb{-webkit-appearance:none;width:11px;height:11px;border-radius:50%;
        background:linear-gradient(135deg,#c4922a,#8a5a10);cursor:pointer;border:1px solid #6a3a00;}

    .mk-speed-bar{display:flex;gap:4px;margin-bottom:3px;}
    .mk-sp{flex:1;padding:5px 0;border:1px solid #c8a84e;border-radius:4px;
        background:#fdf6e0;cursor:pointer;font-family:Arial,sans-serif;
        font-size:10px;color:#7a5a10;transition:.18s;}
    .mk-sp:hover{background:#c8a84e;color:#3a2800;}
    .mk-sp.active{background:linear-gradient(90deg,#8a5a10,#c4922a);color:#fff;border-color:#6a3a00;font-weight:bold;}

    .mk-toggle-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;}
    .mk-toggle-lbl{font-size:12px;color:#7a5a10;}
    .mk-toggle-lbl.on{color:#3a2800;font-weight:bold;}
    .mk-switch{position:relative;width:34px;height:17px;cursor:pointer;flex-shrink:0;}
    .mk-switch input{opacity:0;width:0;height:0;position:absolute;}
    .mk-slider-sw{position:absolute;inset:0;background:#e0d0a0;border:1px solid #c8a84e;border-radius:9px;transition:.25s;}
    .mk-slider-sw:before{content:'';position:absolute;width:11px;height:11px;left:2px;top:2px;
        background:#9a7a2a;border-radius:50%;transition:.25s;}
    .mk-switch input:checked + .mk-slider-sw{background:linear-gradient(90deg,#8a5a10,#c4922a);border-color:#6a3a00;}
    .mk-switch input:checked + .mk-slider-sw:before{transform:translateX(17px);background:#fff;}

    .mk-cmd-row{display:flex;gap:5px;margin-top:2px;}
    .mk-cmd{flex:1;padding:7px 0;border-radius:6px;font-family:Arial,sans-serif;
        font-size:11px;font-weight:bold;cursor:pointer;border:1px solid;transition:.18s;}
    .mk-cmd:active{transform:scale(.97);}
    .mk-cmd.run{background:linear-gradient(90deg,#1a6b10,#2ea822);color:#fff;border-color:#145010;}
    .mk-cmd.run:hover{filter:brightness(1.1);}
    .mk-cmd.pauza{background:linear-gradient(90deg,#8a6a00,#c4a020);color:#fff;border-color:#6a5000;}
    .mk-cmd.pauza:hover{filter:brightness(1.1);}
    .mk-cmd.stop{background:linear-gradient(90deg,#8a1010,#c43020);color:#fff;border-color:#6a0808;}
    .mk-cmd.stop:hover{filter:brightness(1.1);}

    .mk-log-box{background:rgba(139,94,30,.08);border:1px solid #c8a84e;border-radius:6px;
        padding:7px 9px;height:80px;overflow-y:auto;font-size:10px;
        display:flex;flex-direction:column;gap:2px;}
    .mk-log-entry{display:flex;gap:6px;}
    .mk-log-time{color:#b8983a;min-width:38px;flex-shrink:0;font-size:9px;}
    .mk-log-msg{color:#5a3a00;word-break:break-all;line-height:1.4;}
    .mk-log-msg.ok{color:#1a6b10;font-weight:bold;}
    .mk-log-msg.warn{color:#8a6a00;}
    .mk-log-msg.err{color:#8a1010;font-weight:bold;}

    #mk-footer{display:flex;justify-content:space-between;padding:5px 12px;
        border-top:1px solid #c8a84e;font-size:10px;color:#9a7a2a;}
    `;

    // ─── BUILD PANOU ─────────────────────────────────────────
    function creeazaPanou() {
        const style = document.createElement('style');
        style.textContent = CSS_PANOU;
        document.head.appendChild(style);

        // Buton flotant
        const floatBtn = document.createElement('button');
        floatBtn.id = 'mk-float';
        floatBtn.textContent = '⚖ Exchange';
        floatBtn.addEventListener('click', togglePanou);
        document.body.appendChild(floatBtn);

        // Panou
        const panel = document.createElement('div');
        panel.id = 'mk-panel';
        panel.innerHTML = `
            <div id="mk-header">
                <span id="mk-header-title">⚖ Auto Exchange</span>
                <div id="mk-header-status">
                    <div class="mk-dot" id="mk-dot"></div>
                    <span id="mk-status-txt">ACTIV</span>
                </div>
                <button id="mk-close">✕</button>
            </div>
            <div id="mk-body">

                <div>
                    <div class="mk-sect">Statistici</div>
                    <div class="mk-stat-row"><span class="mk-stat-lbl">Cumparari sesiune</span><span class="mk-stat-val" id="mk-buy-cnt">0</span></div>
                    <div class="mk-stat-row"><span class="mk-stat-lbl">Pauze lungi</span><span class="mk-stat-val" id="mk-pause-cnt">0</span></div>
                    <div class="mk-stat-row"><span class="mk-stat-lbl">Uptime</span><span class="mk-stat-val" id="mk-up">0s</span></div>
                </div>

                <div>
                    <div class="mk-sect">Resurse active</div>
                    <div class="mk-res-row">
                        <label class="mk-rc"><input type="checkbox" id="r-wood" checked><div class="mk-rb">✓</div><span class="mk-rl">Lemn</span></label>
                        <label class="mk-rc"><input type="checkbox" id="r-stone" checked><div class="mk-rb">✓</div><span class="mk-rl">Argila</span></label>
                        <label class="mk-rc"><input type="checkbox" id="r-iron" checked><div class="mk-rb">✓</div><span class="mk-rl">Fier</span></label>
                    </div>
                </div>

                <div>
                    <div class="mk-sect">Parametri</div>
                    <div class="mk-sl-row">
                        <span class="mk-sl-lbl">Stoc minim</span>
                        <input type="range" class="mk-range" min="1" max="100" value="10" id="sl-stoc">
                        <span class="mk-sl-val" id="sl-stoc-val">10</span>
                    </div>
                    <div class="mk-sl-row">
                        <span class="mk-sl-lbl">Prag magazie</span>
                        <input type="range" class="mk-range" min="50" max="99" value="95" id="sl-prag">
                        <span class="mk-sl-val" id="sl-prag-val">95%</span>
                    </div>
                </div>

                <div>
                    <div class="mk-sect">Viteza actiune</div>
                    <div class="mk-speed-bar">
                        <button class="mk-sp" id="sp1">Lent</button>
                        <button class="mk-sp active" id="sp2">Normal</button>
                        <button class="mk-sp" id="sp3">Rapid</button>
                        <button class="mk-sp" id="sp4">Turbo</button>
                    </div>
                </div>

                <div>
                    <div class="mk-sect">Optiuni</div>
                    <div class="mk-toggle-row">
                        <span class="mk-toggle-lbl" id="lbl-pauze">Pauze lungi</span>
                        <label class="mk-switch"><input type="checkbox" id="tog-pauze" checked><span class="mk-slider-sw"></span></label>
                    </div>
                    <div class="mk-toggle-row">
                        <span class="mk-toggle-lbl" id="lbl-targ">Blocare pe targ</span>
                        <label class="mk-switch"><input type="checkbox" id="tog-targ"><span class="mk-slider-sw"></span></label>
                    </div>
                </div>

                <div class="mk-cmd-row">
                    <button class="mk-cmd run" id="mk-btn-run">▶ Run</button>
                    <button class="mk-cmd pauza" id="mk-btn-pauza">⏸ Pauza</button>
                    <button class="mk-cmd stop" id="mk-btn-stop">■ Stop</button>
                </div>

                <div>
                    <div class="mk-sect">Log activitate</div>
                    <div class="mk-log-box" id="mk-log-box"></div>
                </div>

            </div>
            <div id="mk-footer">
                <span>by <b>Marrcky</b> · v17.0</span>
                <span>cumparari: <b id="mk-buy-footer">0</b></span>
            </div>
        `;
        document.body.appendChild(panel);

        // Drag
        makeDraggable(panel, document.getElementById('mk-header'));

        // Inchide
        document.getElementById('mk-close').addEventListener('click', togglePanou);

        // Resurse
        ['wood','stone','iron'].forEach(r => {
            document.getElementById(`r-${r}`).addEventListener('change', (e) => {
                RESURSE_ACTIVE[r] = e.target.checked;
                salveazaSetari();
                log(`Resursa ${r}: ${e.target.checked ? 'activa' : 'dezactivata'}.`);
            });
        });

        // Slidere
        document.getElementById('sl-stoc').addEventListener('input', (e) => {
            MINIM_STOC = parseInt(e.target.value);
            document.getElementById('sl-stoc-val').textContent = MINIM_STOC;
            salveazaSetari();
        });
        document.getElementById('sl-prag').addEventListener('input', (e) => {
            PRAG_MAGAZIE = parseInt(e.target.value) / 100;
            document.getElementById('sl-prag-val').textContent = e.target.value + '%';
            salveazaSetari();
        });

        // Viteza
        [1,2,3,4].forEach(n => {
            document.getElementById(`sp${n}`).addEventListener('click', () => {
                VITEZA = n;
                [1,2,3,4].forEach(i => document.getElementById(`sp${i}`).classList.toggle('active', i === n));
                salveazaSetari();
                log(`Viteza: ${['','Lent','Normal','Rapid','Turbo'][n]}`);
            });
        });

        // Toggle pauze
        document.getElementById('tog-pauze').addEventListener('change', (e) => {
            pauzaActivata = e.target.checked;
            document.getElementById('lbl-pauze').classList.toggle('on', pauzaActivata);
            salveazaSetari();
        });

        // Toggle targ
        document.getElementById('tog-targ').addEventListener('change', (e) => {
            BLOCARE_TARG = e.target.checked;
            document.getElementById('lbl-targ').classList.toggle('on', BLOCARE_TARG);
            if (BLOCARE_TARG) {
                clearTimeout(refreshTimer);
                if (pauzaActivata) {
                    pauzaActivata = false;
                    document.getElementById('tog-pauze').checked = false;
                    document.getElementById('lbl-pauze').classList.remove('on');
                }
            } else if (peExchange && scriptActiv) { scheduleRefresh(); }
            salveazaSetari();
        });

        // Butoane
        document.getElementById('mk-btn-run').addEventListener('click', async () => {
            if (!peExchange) { log('Nu esti pe pagina Exchange!'); return; }
            if (ocupat) { log('Deja in curs...'); return; }
            if (!scriptActiv) { log('Scriptul e oprit.'); return; }
            log('Run manual.');
            ocupat = true; await ruleazaAutoBuy(); ocupat = false;
        });

        document.getElementById('mk-btn-pauza').addEventListener('click', async () => {
            if (!scriptActiv) return;
            pauseCnt++;
            document.getElementById('mk-pause-cnt').textContent = pauseCnt;
            const min = Math.floor(Math.random() * (PAUZA_MAX - PAUZA_MIN)) + PAUZA_MIN;
            log(`Pauza fortata: ${min} min.`);
            inPauzaLunga = true;
            clearTimeout(refreshTimer);
            await delayRandom(min * 60 * 1000, min * 60 * 1000 + 10000);
            inPauzaLunga = false;
            log('Pauza terminata.');
            if (peExchange && scriptActiv && !BLOCARE_TARG) scheduleRefresh();
        });

        document.getElementById('mk-btn-stop').addEventListener('click', () => {
            scriptActiv = false;
            clearTimeout(refreshTimer);
            if (pollingInterval) clearTimeout(pollingInterval);
            document.getElementById('mk-dot').classList.add('off');
            document.getElementById('mk-status-txt').textContent = 'OPRIT';
            log('Script oprit.');
        });

        // Uptime
        setInterval(() => {
            const sec = Math.floor((Date.now() - sesiuneStart) / 1000);
            const el = document.getElementById('mk-up');
            if (el) el.textContent = sec < 60 ? sec + 's' : Math.floor(sec/60) + 'm' + String(sec%60).padStart(2,'0') + 's';
            const elF = document.getElementById('mk-buy-footer');
            if (elF) elF.textContent = buyCnt;
        }, 1000);

        sincronizeazaUI();
    }

    function sincronizeazaUI() {
        ['wood','stone','iron'].forEach(r => {
            const el = document.getElementById(`r-${r}`);
            if (el) el.checked = RESURSE_ACTIVE[r];
        });
        const slStoc = document.getElementById('sl-stoc');
        if (slStoc) { slStoc.value = MINIM_STOC; document.getElementById('sl-stoc-val').textContent = MINIM_STOC; }
        const slPrag = document.getElementById('sl-prag');
        if (slPrag) { slPrag.value = Math.round(PRAG_MAGAZIE*100); document.getElementById('sl-prag-val').textContent = Math.round(PRAG_MAGAZIE*100)+'%'; }
        [1,2,3,4].forEach(i => { const el = document.getElementById(`sp${i}`); if (el) el.classList.toggle('active', i===VITEZA); });
        const togPauze = document.getElementById('tog-pauze');
        if (togPauze) { togPauze.checked = pauzaActivata; document.getElementById('lbl-pauze').classList.toggle('on', pauzaActivata); }
        const togTarg = document.getElementById('tog-targ');
        if (togTarg) { togTarg.checked = BLOCARE_TARG; document.getElementById('lbl-targ').classList.toggle('on', BLOCARE_TARG); }
        const dot = document.getElementById('mk-dot');
        const txt = document.getElementById('mk-status-txt');
        if (dot) dot.classList.toggle('off', !scriptActiv);
        if (txt) txt.textContent = scriptActiv ? 'ACTIV' : 'OPRIT';
    }

    function togglePanou() {
        const p = document.getElementById('mk-panel');
        if (!p) return;
        const open = p.style.display === 'none' || !p.style.display;
        p.style.display = open ? 'block' : 'none';
        if (open) sincronizeazaUI();
    }

    function actualizareLog() {
        const box = document.getElementById('mk-log-box');
        if (!box) return;
        box.innerHTML = logLines.map(l => {
            const d   = new Date(l.time - sesiuneStart);
            const t   = `${String(Math.floor(d/60000)).padStart(2,'0')}:${String(Math.floor((d%60000)/1000)).padStart(2,'0')}`;
            const tip = l.msg.includes('Cumpar') || l.msg.includes('complet') ? 'ok'
                      : l.msg.includes('Pauza') || l.msg.includes('BLOCARE') ? 'warn'
                      : l.msg.includes('oprit') || l.msg.includes('Captcha') ? 'err' : '';
            return `<div class="mk-log-entry"><span class="mk-log-time">${t}</span><span class="mk-log-msg ${tip}">${l.msg}</span></div>`;
        }).join('');
        box.scrollTop = box.scrollHeight;
    }

    function makeDraggable(el, handle) {
        let ox=0,oy=0,mx=0,my=0;
        handle.addEventListener('mousedown', function(e) {
            e.preventDefault(); mx=e.clientX; my=e.clientY;
            document.addEventListener('mousemove', onDrag);
            document.addEventListener('mouseup', onStop);
        });
        function onDrag(e) {
            ox=mx-e.clientX; oy=my-e.clientY; mx=e.clientX; my=e.clientY;
            el.style.bottom='auto'; el.style.top=(el.offsetTop-oy)+'px';
            el.style.left=(el.offsetLeft-ox)+'px';
        }
        function onStop() {
            document.removeEventListener('mousemove',onDrag);
            document.removeEventListener('mouseup',onStop);
        }
    }

    // Ctrl+M
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'm') { e.preventDefault(); togglePanou(); }
    });

    // ─── PORNIRE ─────────────────────────────────────────────
    incarcaSetari();
    window.addEventListener('load', async () => {
        creeazaPanou();
        verificaRevenire();
        if (!peExchange) return;
        await delayRandom(600, 1200);
        log('Script pornit. Apasa butonul ⚖ Exchange.');
        pornestObservareStoc();
        if (existaStocSuficient()) { ocupat = true; await ruleazaAutoBuy(); ocupat = false; }
        scheduleRefresh();
    });

})();
