// ==UserScript==
// @name         Triburile.ro - Auto Cumpara Premium Exchange
// @namespace    http://tampermonkey.net/
// @version      14.0
// @author       Marrcky
// @description  Cumpara automat resurse echilibrat din depozitul premium
// @match        https://*.triburile.ro/game.php*
// @grant        none
// ==/UserScript==

// ==UserScript==
// @name         Triburile.ro - Auto Cumpara Premium Exchange
// @namespace    http://tampermonkey.net/
// @version      16.0
// @author       Marrcky
// @description  Cumpara automat resurse echilibrat din depozitul premium
// @match        https://*.triburile.ro/game.php*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // ─── CONFIGURARE DEFAULT ────────────────────────────────
    let MINIM_STOC   = 10;
    let PRAG_MAGAZIE = 0.95;
    let REFRESH_MIN  = 40;
    let REFRESH_MAX  = 90;
    let PAUZA_MIN    = 5;
    let PAUZA_MAX    = 15;
    let SANSA_PAUZA  = 0.15;
    let SANSA_NAVIGA = 0.40;

    // Resurse active (controlate din panou)
    let RESURSE_ACTIVE = { wood: true, stone: true, iron: true };

    // Viteza: 1=lent, 2=normal, 3=rapid, 4=turbo
    let VITEZA = 2;

    // Blocare pe targ (nu mai navigheaza intermediar, nu da refresh)
    let BLOCARE_TARG = false;

    const MOD_DETECTIE = 'hybrid';
    const SK_RETURN   = 'mkt_last';
    const SK_TIME     = 'mkt_ts';
    const SK_MOD      = 'mkt_md';
    const SK_SETTINGS = 'mkt_cfg';

    function salveazaSetari() {
        const cfg = {
            MINIM_STOC,
            PRAG_MAGAZIE,
            VITEZA,
            BLOCARE_TARG,
            pauzaActivata,
            RESURSE_ACTIVE: { ...RESURSE_ACTIVE }
        };
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
        } catch(e) {
            console.debug('[mk] Eroare incarcare setari:', e);
        }
    }
    // ────────────────────────────────────────────────────────

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
        console.debug('[mk]', ...args);
        const msg = args.join(' ');
        logLines.push({ time: Date.now(), msg });
        if (logLines.length > 60) logLines.shift();
        actualizareLog();
    };

    // ─── DELAYS IN FUNCTIE DE VITEZA ────────────────────────
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

    // ─── CLICK UMAN ─────────────────────────────────────────
    function clickUman(element) {
        const rect = element.getBoundingClientRect();
        const x = rect.left + (rect.width  * (0.3 + Math.random() * 0.4));
        const y = rect.top  + (rect.height * (0.3 + Math.random() * 0.4));
        element.dispatchEvent(new MouseEvent('mousemove',  { bubbles: true, cancelable: true, clientX: x - 10 + Math.random() * 5, clientY: y - 5 + Math.random() * 5 }));
        element.dispatchEvent(new MouseEvent('mouseover',  { bubbles: true, cancelable: true, clientX: x, clientY: y }));
        element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
        element.dispatchEvent(new MouseEvent('mousedown',  { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1 }));
        element.dispatchEvent(new MouseEvent('mouseup',    { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 0 }));
        element.dispatchEvent(new MouseEvent('click',      { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 0 }));
    }

    // ─── TASTARE UMANA ───────────────────────────────────────
    async function seteazaInput(input, valoare) {
        const d = getDelays();
        input.focus();
        input.value = '';
        input.dispatchEvent(new Event('focus', { bubbles: true }));
        const str = String(valoare);
        for (let i = 0; i < str.length; i++) {
            const ch = str[i];
            if (Math.random() < 0.08 && str.length > 1) {
                const g = String(Math.floor(Math.random() * 10));
                input.value += g;
                input.dispatchEvent(new KeyboardEvent('keydown',  { key: g, bubbles: true }));
                input.dispatchEvent(new KeyboardEvent('keypress', { key: g, bubbles: true }));
                input.dispatchEvent(new KeyboardEvent('keyup',    { key: g, bubbles: true }));
                input.dispatchEvent(new Event('input', { bubbles: true }));
                await delayRandom(d.tastMin * 1.5, d.tastMax * 2);
                input.value = input.value.slice(0, -1);
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
                input.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Backspace', bubbles: true }));
                input.dispatchEvent(new Event('input', { bubbles: true }));
                await delayRandom(d.tastMin, d.tastMax);
            }
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
        const map = { wood: 'wood', stone: 'stone', iron: 'iron' };
        return Object.keys(map).filter(r => RESURSE_ACTIVE[r]);
    }

    function existaStocSuficient() {
        return getResurseActive().some(r => citesteStocExchange(r) > MINIM_STOC);
    }

    function calculeazaPrioritati() {
        const sat        = citesteResurseSat();
        const capacitate = citesteCapacitateMagazie();
        log(`Resurse sat — Lemn:${sat.wood} Argila:${sat.stone} Fier:${sat.iron}`);
        const procente = {
            wood:  sat.wood  / (capacitate.wood  || 99999),
            stone: sat.stone / (capacitate.stone || 99999),
            iron:  sat.iron  / (capacitate.iron  || 99999)
        };
        const ordine = getResurseActive()
            .filter(r => {
                const stocEx = citesteStocExchange(r);
                const prc    = procente[r];
                if (stocEx <= MINIM_STOC) { log(`${r}: stoc insuficient (${stocEx})`); return false; }
                if (prc >= PRAG_MAGAZIE)  { log(`${r}: magazia plina (${(prc * 100).toFixed(1)}%)`); return false; }
                return true;
            })
            .sort((a, b) => procente[a] - procente[b]);
        log(`Ordine: ${ordine.join(' > ') || 'nimic'}`);
        return { ordine, procente, sat, capacitate };
    }

    function calculeazaCantitate(resursa, stocExchange, sat, capacitate) {
        const spatLiber = Math.floor((capacitate[resursa] || 99999) * PRAG_MAGAZIE) - sat[resursa];
        if (spatLiber <= 0) return 0;
        const maxPosibil = Math.min(stocExchange, spatLiber);
        return Math.floor(maxPosibil * (0.80 + Math.random() * 0.20));
    }

    function asteaptaButonActiv() {
        return new Promise((resolve) => {
            const interval = setInterval(() => {
                const buton = document.querySelector('.btn-premium-exchange-buy');
                if (!buton) { clearInterval(interval); resolve(); return; }
                const text     = buton.value || buton.textContent || '';
                const eDisabled = buton.disabled || buton.classList.contains('btn-disabled');
                const cooldown  = text.includes('așteptați') || text.includes('asteptati');
                if (!eDisabled && !cooldown) { clearInterval(interval); resolve(); }
            }, 500);
            setTimeout(() => { clearInterval(interval); resolve(); }, 15000);
        });
    }

    function asteaptaConfirmare() {
        return new Promise((resolve) => {
            const handle = async (btn, msg) => {
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

            function gasesteButon() {
                // Confirmare normala (da)
                const da = document.querySelector('button.evt-confirm-btn.btn-confirm-yes');
                if (esteVizibil(da)) return { btn: da, msg: 'Confirmare apasata!' };

                // Anulare normala (nu)
                const nu = document.querySelector('button.evt-cancel-btn.btn-confirm-no');
                if (esteVizibil(nu)) return { btn: nu, msg: 'Stoc insuf — Intrerupe!' };

                // Butoane din confirmation-box (structura exacta triburile)
                const dinBox = document.querySelectorAll(
                    '.confirmation-box .confirmation-buttons button, ' +
                    '.confirmation-box .confirmation-buttons a, ' +
                    '#premium_exchange .confirmation-buttons button, ' +
                    '#premium_exchange .confirmation-buttons a'
                );
                for (const b of dinBox) {
                    if (esteVizibil(b)) return { btn: b, msg: `Inchis: "${(b.textContent||'').trim()}"` };
                }

                // Fallback — orice buton/link vizibil din #fader
                const dinFader = document.querySelectorAll('#fader button, #fader a.btn, #fader input[type=button]');
                for (const b of dinFader) {
                    if (esteVizibil(b)) return { btn: b, msg: `Fader: "${(b.textContent||b.value||'').trim()}"` };
                }

                return null;
            }

            // Verifica imediat — fereastra poate fi deja deschisa
            const imediat = gasesteButon();
            if (imediat) { handle(imediat.btn, imediat.msg); return; }

            const obs = new MutationObserver(async () => {
                const gasit = gasesteButon();
                if (gasit) { obs.disconnect(); await handle(gasit.btn, gasit.msg); }
            });
            obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
            setTimeout(() => { obs.disconnect(); resolve(); }, 8000);
        });
    }

    async function verificaPauzaLunga() {
        if (!pauzaActivata || BLOCARE_TARG) return;
        if (Math.random() < SANSA_PAUZA) {
            const min = Math.floor(Math.random() * (PAUZA_MAX - PAUZA_MIN)) + PAUZA_MIN;
            log(`Pauza lunga de ${min} minute.`);
            pauseCnt++;
            const el = document.getElementById('mk-pause-cnt');
            if (el) el.textContent = pauseCnt;
            inPauzaLunga = true;
            await delayRandom(min * 60 * 1000, min * 60 * 1000 + 30000);
            inPauzaLunga = false;
            log('Pauza terminata.');
        }
    }

    function alegeModDetectie() {
        if (MOD_DETECTIE === 'observer') return 'observer';
        if (MOD_DETECTIE === 'polling')  return 'polling';
        let m = sessionStorage.getItem(SK_MOD);
        if (!m) {
            m = Math.random() < 0.5 ? 'observer' : 'polling';
            sessionStorage.setItem(SK_MOD, m);
        }
        return m;
    }

    function pornestObservareStoc() {
        const mod = alegeModDetectie();
        log(`Mod detectie stoc: ${mod}`);
        if (mod === 'observer') {
            const obs = new MutationObserver(async () => {
                if (!scriptActiv || ocupat || inPauzaLunga) return;
                if (!existaStocSuficient()) return;
                log('Stoc detectat (observer)!');
                ocupat = true;
                await ruleazaAutoBuy();
                ocupat = false;
            });
            getResurseActive().forEach(r => {
                const el = document.getElementById(`premium_exchange_stock_${r}`);
                if (el) obs.observe(el, { childList: true, subtree: true, characterData: true });
            });
        } else {
            const prog = () => {
                const iv = Math.floor(Math.random() * 4000) + 3000;
                pollingInterval = setTimeout(async () => {
                    if (scriptActiv && !ocupat && !inPauzaLunga && existaStocSuficient()) {
                        log('Stoc detectat (polling)!');
                        ocupat = true;
                        await ruleazaAutoBuy();
                        ocupat = false;
                    }
                    prog();
                }, iv);
            };
            prog();
        }
    }

    const PAGINI_NATURALE = [
        `game.php?village=${village}&screen=main`,
        `game.php?village=${village}&screen=train`,
        `game.php?village=${village}&screen=smith`,
        `game.php?village=${village}&screen=overview_villages`,
        `game.php?village=${village}&screen=report`,
        `game.php?village=${village}&screen=map`,
    ];
    const URL_EXCHANGE = `game.php?village=${village}&screen=market&mode=exchange`;

    function scheduleRefresh() {
        // Daca blocare targ e activa, nu navigam si nu dam refresh
        if (BLOCARE_TARG) {
            log('Blocare targ activa — fara refresh/navigare.');
            return;
        }
        if (!scriptActiv) return;
        const sec = Math.floor(Math.random() * (REFRESH_MAX - REFRESH_MIN)) + REFRESH_MIN;
        if (Math.random() < SANSA_NAVIGA) {
            const pg = PAGINI_NATURALE[Math.floor(Math.random() * PAGINI_NATURALE.length)];
            log(`In ${sec}s navighez intermediar.`);
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
        log(`Pagina intermediara — revin in ${Math.round(wait / 1000)}s.`);
        setTimeout(() => { window.location.href = returnUrl; }, wait);
    }

    async function ruleazaAutoBuy() {
        if (!scriptActiv) return;
        const captcha = document.querySelector('.bot-check, .captcha, [class*="captcha"], [id*="captcha"]');
        if (captcha && captcha.offsetParent !== null) { log('Captcha detectat!'); return; }
        await verificaPauzaLunga();
        if (inPauzaLunga || !scriptActiv) return;

        const { ordine, procente, sat, capacitate } = calculeazaPrioritati();
        if (ordine.length === 0) { log('Nimic de cumparat.'); return; }

        for (const resursa of ordine) {
            if (!scriptActiv) break;
            const stocEx    = citesteStocExchange(resursa);
            const cantitate = calculeazaCantitate(resursa, stocEx, sat, capacitate);
            if (cantitate <= 0) { log(`${resursa}: cantitate 0.`); continue; }
            const input = document.querySelector(`input[name="buy_${resursa}"]`);
            if (!input) { log(`${resursa}: input negasit.`); continue; }
            const ok = await asteaptaInputActiv(input);
            if (!ok) { log(`${resursa}: disabled.`); continue; }
            document.querySelectorAll('input.premium-exchange-input[data-type="buy"]').forEach(i => {
                i.value = '';
                i.dispatchEvent(new Event('input', { bubbles: true }));
            });
            log(`${resursa}: cumpar ${cantitate} (stoc=${stocEx}, mag=${(procente[resursa] * 100).toFixed(1)}%)`);
            await delayUman();
            await seteazaInput(input, cantitate);
            await delayRandom(300, 700);
            await asteaptaButonActiv();
            const buton = document.querySelector('.btn-premium-exchange-buy');
            if (!buton) { log('Buton negasit!'); continue; }
            await delayRandom(200, 500);
            clickUman(buton);
            buyCnt++;
            const elBuy = document.getElementById('mk-buy-cnt');
            if (elBuy) elBuy.textContent = buyCnt;
            log(`Buy: ${resursa}.`);
            afiseazaNotificare(resursa, cantitate);
            await asteaptaConfirmare();
            await delayRandom(600, 1200);
            await asteaptaButonActiv();
        }
        log('Procesare completa.');

        // Daca blocare targ e activa, reprogrameaza imediat un nou ciclu
        if (BLOCARE_TARG && scriptActiv) {
            const d = getDelays();
            await delayRandom(d.umanMin, d.umanMax);
            if (!ocupat) {
                ocupat = true;
                await ruleazaAutoBuy();
                ocupat = false;
            }
        }
    }

    // ─── NOTIFICARI VIZUALE ──────────────────────────────────
    function afiseazaNotificare(resursa, cantitate) {
        const numeLisibil = { wood: 'Lemn', stone: 'Argila', iron: 'Fier' };
        const notif = document.createElement('div');
        notif.style.cssText = `
            position:fixed;bottom:24px;right:24px;z-index:9999999;
            background:#030d03;border-left:2px solid #22c55e;border:1px solid #14532d;
            padding:8px 14px;font-family:'Courier New',monospace;font-size:11px;
            color:#4ade80;letter-spacing:1px;border-radius:3px;
            transition:opacity 0.4s;opacity:1;pointer-events:none;
        `;
        notif.textContent = `> CUMPARAT: ${numeLisibil[resursa] || resursa} x${cantitate}`;
        document.body.appendChild(notif);
        setTimeout(() => { notif.style.opacity = '0'; setTimeout(() => notif.remove(), 400); }, 2500);
    }

    // ─── PANOU DE CONTROL ────────────────────────────────────
    function creeazaPanou() {
        const style = document.createElement('style');
        style.textContent = `
            #mk-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.65);display:flex;align-items:center;justify-content:center;z-index:999998;opacity:0;pointer-events:none;transition:opacity 0.2s}
            #mk-overlay.open{opacity:1;pointer-events:all}
            #mk-panel{background:#050505;border:1px solid #1a1a1a;border-radius:4px;width:360px;max-width:95vw;font-family:'Courier New',monospace;color:#e2e8f0;position:relative;overflow:hidden;transform:translateY(16px) scale(0.97);transition:transform 0.2s}
            #mk-overlay.open #mk-panel{transform:translateY(0) scale(1)}
            #mk-panel::before{content:'';position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,255,0,0.012) 2px,rgba(0,255,0,0.012) 4px);pointer-events:none;z-index:0}
            .mk-hdr{background:#030303;padding:8px 12px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #1a1a1a;position:relative;z-index:1}
            .mk-hdr-title{font-size:10px;color:#22c55e;letter-spacing:3px}
            .mk-hdr-r{display:flex;align-items:center;gap:8px}
            .mk-pill{display:flex;align-items:center;gap:4px;font-size:8px;color:#4ade80;letter-spacing:1px}
            .mk-pill-dot{width:5px;height:5px;border-radius:50%;background:#22c55e;animation:mk-blink 1.2s infinite}
            @keyframes mk-blink{0%,100%{opacity:1}50%{opacity:0.2}}
            .mk-kbd-badge{font-size:8px;color:#333;background:#0a0a0a;border:1px solid #1a1a1a;border-radius:2px;padding:1px 5px;letter-spacing:1px}
            .mk-close{background:none;border:none;color:#2a2a2a;cursor:pointer;font-size:14px;padding:0 4px;font-family:'Courier New',monospace;transition:color .15s}
            .mk-close:hover{color:#ef4444}
            .mk-body{padding:11px 13px;position:relative;z-index:1;display:flex;flex-direction:column;gap:9px}
            .mk-prompt{font-size:9px;color:#2a2a2a;letter-spacing:1px;display:flex;justify-content:space-between}
            .mk-prompt-accent{color:#22c55e}
            .mk-sep{border:none;border-top:1px solid #111;margin:0}
            .mk-sect{font-size:8px;color:#222;letter-spacing:2px;margin-bottom:6px}
            .mk-line{display:flex;align-items:center;gap:6px;margin-bottom:4px}
            .mk-arr{color:#1a3a1a;font-size:10px;flex-shrink:0}
            .mk-line-lbl{font-size:9px;color:#1c3a1c;letter-spacing:1px;width:90px;flex-shrink:0}
            .mk-line-val{font-size:10px;color:#4ade80}
            .mk-res-row{display:flex;gap:12px}
            .mk-rc{display:flex;align-items:center;gap:5px;cursor:pointer}
            .mk-rc input{display:none}
            .mk-rb{width:13px;height:13px;border:1px solid #1f1f1f;border-radius:1px;display:flex;align-items:center;justify-content:center;font-size:8px;color:transparent;transition:.15s;background:#0a0a0a}
            .mk-rc input:checked ~ .mk-rb{color:#4ade80;background:#031a03;border-color:#166534}
            .mk-rl{font-size:10px;color:#2a2a2a;letter-spacing:1px;transition:.15s}
            .mk-rc input:checked ~ .mk-rl{color:#4ade80}
            .mk-sl-row{display:flex;align-items:center;gap:8px;margin-bottom:5px}
            .mk-sl-lbl{font-size:9px;color:#1c3a1c;letter-spacing:1px;width:80px;flex-shrink:0}
            .mk-sl-val{font-size:10px;color:#22c55e;width:36px;text-align:right;flex-shrink:0}
            .mk-panel-range{flex:1;-webkit-appearance:none;height:2px;background:#141414;outline:none;cursor:pointer}
            .mk-panel-range::-webkit-slider-thumb{-webkit-appearance:none;width:9px;height:9px;border-radius:50%;background:#22c55e;cursor:pointer}
            .mk-speed-bar{display:flex;gap:4px}
            .mk-sp{flex:1;height:20px;border:1px solid #1a1a1a;border-radius:2px;background:#0a0a0a;cursor:pointer;font-family:'Courier New',monospace;font-size:8px;color:#222;letter-spacing:1px;transition:.2s;display:flex;align-items:center;justify-content:center}
            .mk-sp:hover{border-color:#166534;color:#4ade80}
            .mk-sp.active{background:#031a03;border-color:#22c55e;color:#22c55e}
            .mk-speed-desc{margin-top:4px;font-size:8px;color:#1c3a1c;letter-spacing:1px}
            .mk-toggle-row{display:flex;align-items:center;justify-content:space-between}
            .mk-toggle-lbl{font-size:10px;color:#2a2a2a;letter-spacing:1px}
            .mk-toggle-lbl.active-lbl{color:#4ade80}
            .mk-switch{position:relative;width:32px;height:16px;cursor:pointer;flex-shrink:0}
            .mk-switch input{opacity:0;width:0;height:0;position:absolute}
            .mk-slider-sw{position:absolute;inset:0;background:#0f0f0f;border:1px solid #1a1a1a;border-radius:8px;transition:.25s;cursor:pointer}
            .mk-slider-sw:before{content:'';position:absolute;width:10px;height:10px;left:2px;top:2px;background:#2a2a2a;border-radius:50%;transition:.25s}
            .mk-switch input:checked + .mk-slider-sw{background:#031a03;border-color:#166534}
            .mk-switch input:checked + .mk-slider-sw:before{transform:translateX(16px);background:#22c55e}
            .mk-notif-bar{padding:5px 9px;background:#030d03;border-left:2px solid #22c55e;font-size:9px;color:#4ade80;display:flex;align-items:center;gap:6px}
            .mk-notif-dot{width:4px;height:4px;border-radius:50%;background:#22c55e;flex-shrink:0;animation:mk-blink 1.5s infinite}
            .mk-cmd-row{display:flex;gap:5px}
            .mk-cmd{flex:1;padding:7px 0;background:#0a0a0a;border:1px solid #1a1a1a;font-family:'Courier New',monospace;font-size:9px;letter-spacing:1px;cursor:pointer;border-radius:2px;transition:.18s;font-weight:700}
            .mk-cmd.run{color:#4ade80;border-color:#14532d}
            .mk-cmd.run:hover{background:#031a03;border-color:#22c55e;color:#86efac}
            .mk-cmd.run:active{transform:scale(0.97)}
            .mk-cmd.pauza{color:#fbbf24;border-color:#78350f}
            .mk-cmd.pauza:hover{background:#1a0f00;border-color:#f59e0b;color:#fde68a}
            .mk-cmd.pauza:active{transform:scale(0.97)}
            .mk-cmd.stop{color:#f87171;border-color:#7f1d1d}
            .mk-cmd.stop:hover{background:#1a0505;border-color:#ef4444;color:#fca5a5}
            .mk-cmd.stop:active{transform:scale(0.97)}
            .mk-log{background:#030303;border:1px solid #111;border-radius:2px;padding:7px 9px;height:75px;overflow-y:auto;font-size:9px;display:flex;flex-direction:column;gap:2px}
            .mk-log-entry{display:flex;gap:7px}
            .mk-log-time{color:#1a1a1a;min-width:42px;flex-shrink:0}
            .mk-log-msg{color:#2a2a2a;word-break:break-all}
            .mk-log-msg.ok{color:#22c55e}
            .mk-log-msg.warn{color:#f59e0b}
            .mk-log-msg.err{color:#ef4444}
            .mk-footer{display:flex;justify-content:space-between;padding:5px 13px;border-top:1px solid #111;position:relative;z-index:1}
            .mk-ft{font-size:8px;color:#1a1a1a;letter-spacing:1px}
            .mk-ft-accent{color:#22c55e}
        `;
        document.head.appendChild(style);

        const overlay = document.createElement('div');
        overlay.id = 'mk-overlay';
        overlay.innerHTML = `
            <div id="mk-panel">
                <div class="mk-hdr">
                    <span class="mk-hdr-title">[ MK_EXCHANGE ]</span>
                    <div class="mk-hdr-r">
                        <div class="mk-pill"><div class="mk-pill-dot" id="mk-status-dot"></div><span id="mk-status-txt">ONLINE</span></div>
                        <span class="mk-kbd-badge">CTRL+M</span>
                        <button class="mk-close" id="mk-close-btn">[X]</button>
                    </div>
                </div>
                <div class="mk-body">

                    <div class="mk-prompt">
                        <span>> uptime: <span class="mk-prompt-accent" id="mk-up">0s</span></span>
                        <span style="color:#1a1a1a" id="mk-clock">--:--:--</span>
                    </div>

                    <hr class="mk-sep">

                    <div>
                        <div class="mk-sect">// STATISTICI</div>
                        <div class="mk-line"><span class="mk-arr">></span><span class="mk-line-lbl">CUMPARARI</span><span class="mk-line-val" id="mk-buy-cnt">0</span></div>
                        <div class="mk-line"><span class="mk-arr">></span><span class="mk-line-lbl">PAUZE</span><span class="mk-line-val" id="mk-pause-cnt">0</span></div>
                        <div class="mk-line"><span class="mk-arr">></span><span class="mk-line-lbl">MOD_DETECTIE</span><span class="mk-line-val" id="mk-mod-val">—</span></div>
                    </div>

                    <hr class="mk-sep">

                    <div>
                        <div class="mk-sect">// RESURSE ACTIVE</div>
                        <div class="mk-res-row">
                            <label class="mk-rc"><input type="checkbox" id="r-wood" checked><div class="mk-rb">✓</div><span class="mk-rl">LEMN</span></label>
                            <label class="mk-rc"><input type="checkbox" id="r-stone" checked><div class="mk-rb">✓</div><span class="mk-rl">ARGILA</span></label>
                            <label class="mk-rc"><input type="checkbox" id="r-iron" checked><div class="mk-rb">✓</div><span class="mk-rl">FIER</span></label>
                        </div>
                    </div>

                    <hr class="mk-sep">

                    <div>
                        <div class="mk-sect">// PARAMETRI</div>
                        <div class="mk-sl-row">
                            <span class="mk-sl-lbl">STOC_MIN</span>
                            <input type="range" class="mk-panel-range" min="1" max="100" value="10" step="1" id="sl-stoc">
                            <span class="mk-sl-val" id="sl-stoc-val">10</span>
                        </div>
                        <div class="mk-sl-row">
                            <span class="mk-sl-lbl">PRAG_MAG</span>
                            <input type="range" class="mk-panel-range" min="50" max="99" value="95" step="1" id="sl-prag">
                            <span class="mk-sl-val" id="sl-prag-val">95%</span>
                        </div>
                    </div>

                    <hr class="mk-sep">

                    <div>
                        <div class="mk-sect">// VITEZA_ACTIUNE</div>
                        <div class="mk-speed-bar">
                            <button class="mk-sp" id="sp1">LENT</button>
                            <button class="mk-sp active" id="sp2">NORMAL</button>
                            <button class="mk-sp" id="sp3">RAPID</button>
                            <button class="mk-sp" id="sp4">TURBO</button>
                        </div>
                        <div class="mk-speed-desc" id="mk-speed-desc">> delay_tastare: 80–220ms _ delay_uman: 1–4s</div>
                    </div>

                    <hr class="mk-sep">

                    <div style="display:flex;flex-direction:column;gap:7px">
                        <div class="mk-sect">// OPTIUNI</div>
                        <div class="mk-toggle-row">
                            <span class="mk-toggle-lbl" id="lbl-pauze">PAUZE_LUNGI</span>
                            <label class="mk-switch"><input type="checkbox" id="tog-pauze" checked><span class="mk-slider-sw"></span></label>
                        </div>
                        <div class="mk-toggle-row">
                            <span class="mk-toggle-lbl" id="lbl-targ">BLOCARE_PE_TARG</span>
                            <label class="mk-switch"><input type="checkbox" id="tog-targ"><span class="mk-slider-sw"></span></label>
                        </div>
                    </div>

                    <hr class="mk-sep">

                    <div class="mk-notif-bar">
                        <div class="mk-notif-dot"></div>
                        <span>notificari_cumparare: enabled</span>
                    </div>

                    <div class="mk-cmd-row">
                        <button class="mk-cmd run" id="mk-btn-run">[RUN]</button>
                        <button class="mk-cmd pauza" id="mk-btn-pauza">[PAUZA]</button>
                        <button class="mk-cmd stop" id="mk-btn-stop">[STOP]</button>
                    </div>

                    <div>
                        <div class="mk-sect">// LOG</div>
                        <div class="mk-log" id="mk-log-box"></div>
                    </div>

                </div>
                <div class="mk-footer">
                    <span class="mk-ft">by <span class="mk-ft-accent">Marrcky</span> _ v16.0</span>
                    <span class="mk-ft">cumparari: <span class="mk-ft-accent" id="mk-buy-footer">0</span></span>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        // ── Inchidere ─────────────────────────────────────────
        document.getElementById('mk-close-btn').addEventListener('click', () => togglePanou(false));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) togglePanou(false); });

        // ── Resurse ───────────────────────────────────────────
        ['wood', 'stone', 'iron'].forEach(r => {
            document.getElementById(`r-${r}`).addEventListener('change', (e) => {
                RESURSE_ACTIVE[r] = e.target.checked;
                log(`Resursa ${r}: ${e.target.checked ? 'activa' : 'dezactivata'}.`);
                salveazaSetari();
            });
        });

        // ── Slidere ───────────────────────────────────────────
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

        // ── Viteza ────────────────────────────────────────────
        const speedDesc = {
            1: '> delay_tastare: 150–400ms _ delay_uman: 4–10s',
            2: '> delay_tastare: 80–220ms _ delay_uman: 1–4s',
            3: '> delay_tastare: 40–100ms _ delay_uman: 0.5–2s',
            4: '> delay_tastare: 10–40ms _ delay_uman: 0.1–0.5s'
        };
        [1, 2, 3, 4].forEach(n => {
            document.getElementById(`sp${n}`).addEventListener('click', () => {
                VITEZA = n;
                [1, 2, 3, 4].forEach(i => document.getElementById(`sp${i}`).classList.toggle('active', i === n));
                document.getElementById('mk-speed-desc').textContent = speedDesc[n];
                log(`Viteza setata: ${['', 'LENT', 'NORMAL', 'RAPID', 'TURBO'][n]}`);
                salveazaSetari();
            });
        });

        // ── Toggle pauze ──────────────────────────────────────
        document.getElementById('tog-pauze').addEventListener('change', (e) => {
            pauzaActivata = e.target.checked;
            const lbl = document.getElementById('lbl-pauze');
            lbl.classList.toggle('active-lbl', pauzaActivata);
            log(`Pauze lungi: ${pauzaActivata ? 'activate' : 'dezactivate'}.`);
            salveazaSetari();
        });

        // ── Toggle blocare targ ───────────────────────────────
        document.getElementById('tog-targ').addEventListener('change', (e) => {
            BLOCARE_TARG = e.target.checked;
            const lbl = document.getElementById('lbl-targ');
            lbl.classList.toggle('active-lbl', BLOCARE_TARG);
            if (BLOCARE_TARG) {
                clearTimeout(refreshTimer);
                log('BLOCARE_TARG activata — scriptul ramane fix pe exchange.');
                if (pauzaActivata) {
                    pauzaActivata = false;
                    document.getElementById('tog-pauze').checked = false;
                    document.getElementById('lbl-pauze').classList.remove('active-lbl');
                    log('Pauze lungi dezactivate automat (blocare targ).');
                }
            } else {
                log('BLOCARE_TARG dezactivata — navigare normala reluata.');
                if (peExchange && scriptActiv) scheduleRefresh();
            }
            salveazaSetari();
        });

        // ── Butoane ───────────────────────────────────────────
        document.getElementById('mk-btn-run').addEventListener('click', async () => {
            if (!peExchange) { log('Nu esti pe pagina de Exchange!'); return; }
            if (ocupat) { log('Deja in curs de cumparare...'); return; }
            if (!scriptActiv) { log('Scriptul e oprit. Reincarca pagina.'); return; }
            log('Run manual initiat.');
            ocupat = true;
            await ruleazaAutoBuy();
            ocupat = false;
        });

        document.getElementById('mk-btn-pauza').addEventListener('click', async () => {
            if (!scriptActiv) return;
            pauseCnt++;
            document.getElementById('mk-pause-cnt').textContent = pauseCnt;
            const min = Math.floor(Math.random() * (PAUZA_MAX - PAUZA_MIN)) + PAUZA_MIN;
            log(`Pauza fortata: ${min} minute.`);
            inPauzaLunga = true;
            clearTimeout(refreshTimer);
            await delayRandom(min * 60 * 1000, min * 60 * 1000 + 10000);
            inPauzaLunga = false;
            log('Pauza fortata terminata.');
            if (peExchange && scriptActiv && !BLOCARE_TARG) scheduleRefresh();
        });

        document.getElementById('mk-btn-stop').addEventListener('click', () => {
            scriptActiv = false;
            clearTimeout(refreshTimer);
            if (pollingInterval) clearTimeout(pollingInterval);
            const dot = document.getElementById('mk-status-dot');
            const txt = document.getElementById('mk-status-txt');
            if (dot) { dot.style.background = '#ef4444'; dot.style.animation = 'none'; }
            if (txt) txt.textContent = 'OPRIT';
            log('Script oprit complet.');
        });

        // ── Uptime + ceas ─────────────────────────────────────
        setInterval(() => {
            const sec = Math.floor((Date.now() - sesiuneStart) / 1000);
            const elUp = document.getElementById('mk-up');
            if (elUp) elUp.textContent = sec < 60 ? sec + 's' : Math.floor(sec / 60) + 'm' + String(sec % 60).padStart(2, '0') + 's';
            const elClock = document.getElementById('mk-clock');
            if (elClock) elClock.textContent = new Date().toTimeString().slice(0, 8);
            const elBuyF = document.getElementById('mk-buy-footer');
            if (elBuyF) elBuyF.textContent = buyCnt;
        }, 1000);
    }

    function sincronizeazaUI() {
        // Resurse
        ['wood', 'stone', 'iron'].forEach(r => {
            const el = document.getElementById(`r-${r}`);
            if (el) el.checked = RESURSE_ACTIVE[r];
        });

        // Slidere
        const slStoc = document.getElementById('sl-stoc');
        const slStocVal = document.getElementById('sl-stoc-val');
        if (slStoc) slStoc.value = MINIM_STOC;
        if (slStocVal) slStocVal.textContent = MINIM_STOC;

        const slPrag = document.getElementById('sl-prag');
        const slPragVal = document.getElementById('sl-prag-val');
        if (slPrag) slPrag.value = Math.round(PRAG_MAGAZIE * 100);
        if (slPragVal) slPragVal.textContent = Math.round(PRAG_MAGAZIE * 100) + '%';

        // Viteza
        const speedDesc = {
            1: '> delay_tastare: 150–400ms _ delay_uman: 4–10s',
            2: '> delay_tastare: 80–220ms _ delay_uman: 1–4s',
            3: '> delay_tastare: 40–100ms _ delay_uman: 0.5–2s',
            4: '> delay_tastare: 10–40ms _ delay_uman: 0.1–0.5s'
        };
        [1, 2, 3, 4].forEach(i => {
            const el = document.getElementById(`sp${i}`);
            if (el) el.classList.toggle('active', i === VITEZA);
        });
        const descEl = document.getElementById('mk-speed-desc');
        if (descEl) descEl.textContent = speedDesc[VITEZA];

        // Toggle pauze
        const togPauze = document.getElementById('tog-pauze');
        const lblPauze = document.getElementById('lbl-pauze');
        if (togPauze) togPauze.checked = pauzaActivata;
        if (lblPauze) lblPauze.classList.toggle('active-lbl', pauzaActivata);

        // Toggle blocare targ
        const togTarg = document.getElementById('tog-targ');
        const lblTarg = document.getElementById('lbl-targ');
        if (togTarg) togTarg.checked = BLOCARE_TARG;
        if (lblTarg) lblTarg.classList.toggle('active-lbl', BLOCARE_TARG);

        // Status dot
        const dot = document.getElementById('mk-status-dot');
        const txt = document.getElementById('mk-status-txt');
        if (dot && txt) {
            dot.style.background = scriptActiv ? '#22c55e' : '#ef4444';
            dot.style.animation  = scriptActiv ? '' : 'none';
            txt.textContent      = scriptActiv ? 'ONLINE' : 'OPRIT';
        }

        // Mod detectie
        const modEl = document.getElementById('mk-mod-val');
        if (modEl) modEl.textContent = sessionStorage.getItem(SK_MOD) || MOD_DETECTIE;

        // Statistici
        const elBuy   = document.getElementById('mk-buy-cnt');
        const elPause = document.getElementById('mk-pause-cnt');
        if (elBuy)   elBuy.textContent   = buyCnt;
        if (elPause) elPause.textContent = pauseCnt;
    }

    function togglePanou(forceState) {
        const overlay = document.getElementById('mk-overlay');
        if (!overlay) return;
        const open = forceState !== undefined ? forceState : !overlay.classList.contains('open');
        overlay.classList.toggle('open', open);
        if (open) sincronizeazaUI();
    }

    function actualizareLog() {
        const box = document.getElementById('mk-log-box');
        if (!box) return;
        box.innerHTML = logLines.map(l => {
            const d = new Date(l.time - sesiuneStart);
            const t = `${String(Math.floor(d / 60000)).padStart(2, '0')}:${String(Math.floor((d % 60000) / 1000)).padStart(2, '0')}`;
            const tip = l.msg.includes('Stoc detectat') || l.msg.includes('pornit') || l.msg.includes('CUMPARAT') || l.msg.includes('Buy:') ? 'ok'
                      : l.msg.includes('Pauza') || l.msg.includes('pauza') || l.msg.includes('BLOCARE') ? 'warn'
                      : l.msg.includes('oprit') || l.msg.includes('Captcha') ? 'err' : '';
            return `<div class="mk-log-entry"><span class="mk-log-time">${t}</span><span class="mk-log-msg ${tip}">${l.msg}</span></div>`;
        }).join('');
        box.scrollTop = box.scrollHeight;
    }

    // ── Ctrl+M shortcut ───────────────────────────────────────
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'm') {
            e.preventDefault();
            togglePanou();
        }
    });

    // ─── PORNIRE ─────────────────────────────────────────────
    incarcaSetari();
    window.addEventListener('load', async () => {
        creeazaPanou();
        verificaRevenire();
        if (!peExchange) return;
        await delayRandom(600, 1200);
        log('Script pornit. Apasa Ctrl+M pentru panou.');
        pornestObservareStoc();
        if (existaStocSuficient()) {
            ocupat = true;
            await ruleazaAutoBuy();
            ocupat = false;
        }
        scheduleRefresh();
    });

})();
