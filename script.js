// ==UserScript==
// @name         Triburile.ro - Auto Cumpara Premium Exchange
// @namespace    http://tampermonkey.net/
// @version      14.0
// @author       Marrcky
// @description  Cumpara automat resurse echilibrat din depozitul premium
// @match        https://*.triburile.ro/game.php*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // ─── CONFIGURARE ───────────────────────────────────────
    const MINIM_STOC   = 10;
    const RESURSE      = ['wood', 'stone', 'iron'];
    const REFRESH_MIN  = 40;
    const REFRESH_MAX  = 90;
    const PAUZA_MIN    = 5;
    const PAUZA_MAX    = 15;
    const SANSA_PAUZA  = 0.15;
    const PRAG_MAGAZIE = 0.95;
    const SANSA_NAVIGA = 0.40;

    // Mod detectie stoc: 'observer', 'polling', 'hybrid'
    // In hybrid, se alege random la fiecare sesiune
    const MOD_DETECTIE = 'hybrid';

    // Chei sessionStorage camuflate
    const SK_RETURN = 'mkt_last';
    const SK_TIME   = 'mkt_ts';
    const SK_MOD    = 'mkt_md'; // salveaza modul ales in sesiunea curenta
    // ────────────────────────────────────────────────────────

    const params     = new URLSearchParams(window.location.search);
    const village    = params.get('village');
    const peExchange = params.get('screen') === 'market' && params.get('mode') === 'exchange';

    let ocupat       = false;
    let inPauzaLunga = false;

    // ─── LOGGER DISCRET ──────────────────────────────────────
    // In loc de console.log vizibil, folosim console.debug
    // care e ascuns by default in Chrome (trebuie activat manual in DevTools)
    const log = (...args) => console.debug('[mk]', ...args);
    // ────────────────────────────────────────────────────────

    const PAGINI_NATURALE = [
        `game.php?village=${village}&screen=main`,
        `game.php?village=${village}&screen=train`,
        `game.php?village=${village}&screen=smith`,
        `game.php?village=${village}&screen=overview_villages`,
        `game.php?village=${village}&screen=report`,
        `game.php?village=${village}&screen=map`,
    ];
    const URL_EXCHANGE = `game.php?village=${village}&screen=market&mode=exchange`;

    function delayRandom(min, max) {
        return new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min)) + min));
    }

    function delayUman() {
        if (Math.random() < 0.3) return delayRandom(4000, 10000);
        return delayRandom(1000, 4000);
    }

    // ─── CLICK UMAN CU COORDONATE REALE ─────────────────────
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

    // ─── TASTARE UMANA CU VARIATIE SI GRESELI ───────────────
    async function seteazaInput(input, valoare) {
        input.focus();
        input.value = '';
        input.dispatchEvent(new Event('focus', { bubbles: true }));

        const str = String(valoare);

        for (let i = 0; i < str.length; i++) {
            const ch = str[i];

            // 8% sansa de greseala de tastare — scrie o cifra gresita apoi sterge
            if (Math.random() < 0.08 && str.length > 1) {
                const greseala = String(Math.floor(Math.random() * 10));
                input.value += greseala;
                input.dispatchEvent(new KeyboardEvent('keydown',  { key: greseala, bubbles: true }));
                input.dispatchEvent(new KeyboardEvent('keypress', { key: greseala, bubbles: true }));
                input.dispatchEvent(new KeyboardEvent('keyup',    { key: greseala, bubbles: true }));
                input.dispatchEvent(new Event('input', { bubbles: true }));

                // Pauza scurta inainte de backspace — om care realizeaza greseala
                await delayRandom(150, 400);

                input.value = input.value.slice(0, -1);
                input.dispatchEvent(new KeyboardEvent('keydown',  { key: 'Backspace', bubbles: true }));
                input.dispatchEvent(new KeyboardEvent('keyup',    { key: 'Backspace', bubbles: true }));
                input.dispatchEvent(new Event('input', { bubbles: true }));

                await delayRandom(100, 250);
            }

            // Tasteaza caracterul corect
            input.value += ch;
            input.dispatchEvent(new KeyboardEvent('keydown',  { key: ch, bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keypress', { key: ch, bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keyup',    { key: ch, bubbles: true }));
            input.dispatchEvent(new Event('input', { bubbles: true }));

            // Delay random intre caractere — viteza de tastare variabila
            await delayRandom(80, 220);
        }

        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.blur();
    }

    function asteaptaInputActiv(input) {
        return new Promise((resolve) => {
            if (!input.disabled) { resolve(true); return; }
            const observer = new MutationObserver(() => {
                if (!input.disabled) { observer.disconnect(); resolve(true); }
            });
            observer.observe(input, { attributes: true, attributeFilter: ['disabled'] });
            setTimeout(() => { observer.disconnect(); resolve(false); }, 3000);
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

    function existaStocSuficient() {
        return RESURSE.some(r => citesteStocExchange(r) > MINIM_STOC);
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

        const ordine = RESURSE
            .filter(r => {
                const stocEx      = citesteStocExchange(r);
                const procMagazie = procente[r];
                if (stocEx <= MINIM_STOC) { log(`${r}: stoc insuficient (${stocEx})`); return false; }
                if (procMagazie >= PRAG_MAGAZIE) { log(`${r}: magazia plina (${(procMagazie*100).toFixed(1)}%)`); return false; }
                return true;
            })
            .sort((a, b) => procente[a] - procente[b]);

        log(`Ordine: ${ordine.join(' → ') || 'nimic'}`);
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
                const text        = buton.value || buton.textContent || '';
                const eDisabled   = buton.disabled || buton.classList.contains('btn-disabled');
                const areCooldown = text.includes('așteptați') || text.includes('asteptati');
                if (!eDisabled && !areCooldown) { clearInterval(interval); resolve(); }
                else log(`Cooldown... (${text.trim()})`);
            }, 500);
            setTimeout(() => { clearInterval(interval); resolve(); }, 15000);
        });
    }

    function asteaptaConfirmare() {
        return new Promise((resolve) => {
            const handleBtn = async (btn, mesaj) => {
                await delayRandom(150, 500);
                clickUman(btn);
                log(mesaj);
                await delayRandom(400, 700);
                resolve();
            };

            const observer = new MutationObserver(async () => {
                const btnDa  = document.querySelector('button.evt-confirm-btn.btn-confirm-yes');
                const btnNu  = document.querySelector('button.evt-cancel-btn.btn-confirm-no');
                if (btnDa && btnDa.offsetParent !== null) { observer.disconnect(); await handleBtn(btnDa, 'Confirmare apasata!'); return; }
                if (btnNu && btnNu.offsetParent !== null) { observer.disconnect(); await handleBtn(btnNu, 'Stoc insuficient — Intrerupe!'); return; }
            });
            observer.observe(document.body, { childList: true, subtree: true });

            // Verifica daca fereastra e deja deschisa
            const btnNuExistent = document.querySelector('button.evt-cancel-btn.btn-confirm-no');
            if (btnNuExistent && btnNuExistent.offsetParent !== null) {
                observer.disconnect();
                handleBtn(btnNuExistent, 'Eroare detectata instant!');
                return;
            }

            setTimeout(() => { observer.disconnect(); resolve(); }, 8000);
        });
    }

    async function verificaPauzaLunga() {
        if (Math.random() < SANSA_PAUZA) {
            const minute = Math.floor(Math.random() * (PAUZA_MAX - PAUZA_MIN)) + PAUZA_MIN;
            log(`Pauza lunga de ${minute} minute.`);
            inPauzaLunga = true;
            await delayRandom(minute * 60 * 1000, minute * 60 * 1000 + 30000);
            inPauzaLunga = false;
            log('Pauza terminata.');
        }
    }

    // ─── MOD DETECTIE STOC: OBSERVER + POLLING HYBRID ───────
    function alegeModDetectie() {
        if (MOD_DETECTIE === 'observer') return 'observer';
        if (MOD_DETECTIE === 'polling')  return 'polling';
        // Hybrid — alege random si salveaza pentru sesiunea curenta
        // (sa nu schimbe modul in mijlocul sesiunii)
        let modSalvat = sessionStorage.getItem(SK_MOD);
        if (!modSalvat) {
            modSalvat = Math.random() < 0.5 ? 'observer' : 'polling';
            sessionStorage.setItem(SK_MOD, modSalvat);
        }
        return modSalvat;
    }

    let pollingInterval = null;

    function pornestObservareStoc() {
        const mod = alegeModDetectie();
        log(`Mod detectie stoc: ${mod}`);

        if (mod === 'observer') {
            // ── MOD OBSERVER ──────────────────────────────────
            // Asculta direct modificarile DOM pe celulele de stoc
            const observerStoc = new MutationObserver(async () => {
                if (ocupat || inPauzaLunga) return;
                if (!existaStocSuficient()) return;
                log('Stoc detectat (observer)!');
                ocupat = true;
                await ruleazaAutoBuy();
                ocupat = false;
            });

            RESURSE.forEach(resursa => {
                const el = document.getElementById(`premium_exchange_stock_${resursa}`);
                if (el) observerStoc.observe(el, { childList: true, subtree: true, characterData: true });
            });

        } else {
            // ── MOD POLLING ───────────────────────────────────
            // Verifica stocul la interval random 3-7 secunde
            // Mai natural — orice pagina face polling periodic
            const ruleazaPolling = async () => {
                if (ocupat || inPauzaLunga) return;
                if (!existaStocSuficient()) return;
                log('Stoc detectat (polling)!');
                ocupat = true;
                await ruleazaAutoBuy();
                ocupat = false;
            };

            const programeazaUrmatoareaVerificare = () => {
                const interval = Math.floor(Math.random() * (7000 - 3000)) + 3000;
                pollingInterval = setTimeout(async () => {
                    await ruleazaPolling();
                    programeazaUrmatoareaVerificare(); // reprogrameaza cu interval nou
                }, interval);
            };

            programeazaUrmatoareaVerificare();
        }
    }
    // ────────────────────────────────────────────────────────

    function scheduleRefresh() {
        if (inPauzaLunga) return;
        const secunde = Math.floor(Math.random() * (REFRESH_MAX - REFRESH_MIN)) + REFRESH_MIN;

        if (Math.random() < SANSA_NAVIGA) {
            const paginaRandom = PAGINI_NATURALE[Math.floor(Math.random() * PAGINI_NATURALE.length)];
            log(`In ${secunde}s navighez intermediar, revin dupa 20-55s.`);
            setTimeout(() => {
                sessionStorage.setItem(SK_RETURN, URL_EXCHANGE);
                sessionStorage.setItem(SK_TIME,   Date.now().toString());
                window.location.href = paginaRandom;
            }, secunde * 1000);
        } else {
            log(`Refresh in ${secunde}s.`);
            setTimeout(() => location.reload(), secunde * 1000);
        }
    }

    function verificaRevenire() {
        const returnUrl  = sessionStorage.getItem(SK_RETURN);
        const returnTime = parseInt(sessionStorage.getItem(SK_TIME) || '0');
        if (!returnUrl) return;

        if (peExchange) {
            sessionStorage.removeItem(SK_RETURN);
            sessionStorage.removeItem(SK_TIME);
            return;
        }

        if (Date.now() - returnTime > 3 * 60 * 1000) {
            sessionStorage.removeItem(SK_RETURN);
            sessionStorage.removeItem(SK_TIME);
            return;
        }

        const timpAsteptare = Math.floor(Math.random() * (55000 - 20000)) + 20000;
        log(`Pagina intermediara — revin in ${Math.round(timpAsteptare/1000)}s.`);
        setTimeout(() => { window.location.href = returnUrl; }, timpAsteptare);
    }

    async function ruleazaAutoBuy() {
        const captcha = document.querySelector('.bot-check, .captcha, [class*="captcha"], [id*="captcha"]');
        if (captcha && captcha.offsetParent !== null) { log('Captcha!'); return; }

        await verificaPauzaLunga();
        if (inPauzaLunga) return;

        const { ordine, procente, sat, capacitate } = calculeazaPrioritati();
        if (ordine.length === 0) { log('Nimic de cumparat.'); return; }

        for (const resursa of ordine) {
            const stocEx    = citesteStocExchange(resursa);
            const cantitate = calculeazaCantitate(resursa, stocEx, sat, capacitate);
            if (cantitate <= 0) { log(`${resursa}: cantitate 0.`); continue; }

            const input = document.querySelector(`input[name="buy_${resursa}"]`);
            if (!input) { log(`${resursa}: input negasit.`); continue; }

            const inputActiv = await asteaptaInputActiv(input);
            if (!inputActiv) { log(`${resursa}: disabled real.`); continue; }

            document.querySelectorAll('input.premium-exchange-input[data-type="buy"]').forEach(i => {
                i.value = '';
                i.dispatchEvent(new Event('input', { bubbles: true }));
            });

            log(`${resursa}: cumpar ${cantitate} (stoc=${stocEx}, mag=${(procente[resursa]*100).toFixed(1)}%)`);
            await delayUman();

            await seteazaInput(input, cantitate); // async — tastare cu variatie
            await delayRandom(300, 700);
            await asteaptaButonActiv();

            const buton = document.querySelector('.btn-premium-exchange-buy');
            if (!buton) { log('Buton negasit!'); continue; }

            await delayRandom(200, 500);
            clickUman(buton);
            log(`Buy: ${resursa}.`);

            await asteaptaConfirmare();
            await delayRandom(600, 1200);
            await asteaptaButonActiv();
        }

        log('Procesare completa.');
    }

    // ─── PORNIRE ────────────────────────────────────────────
    window.addEventListener('load', async () => {
        verificaRevenire();
        if (!peExchange) return;

        await delayRandom(500, 1000);
        pornestObservareStoc();

        if (existaStocSuficient()) {
            ocupat = true;
            await ruleazaAutoBuy();
            ocupat = false;
        }

        scheduleRefresh();
    });

})();
