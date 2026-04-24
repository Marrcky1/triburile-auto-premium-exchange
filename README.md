
# Triburile.ro - Auto Cumpără Premium Exchange

**Auto Cumpără Premium Exchange** este un userscript Tampermonkey pentru Triburile.ro, creat pentru automatizarea cumpărării echilibrate de resurse din Premium Exchange.

Scriptul analizează resursele existente în sat, capacitatea magaziei și stocul disponibil în Exchange, apoi decide automat ce resurse trebuie cumpărate pentru a menține depozitul cât mai echilibrat. Include un panou de control modern, setări salvate local, moduri de viteză, pauze configurabile și opțiune de blocare pe pagina de târg.

## Funcționalități

- Cumpărare automată de resurse din Premium Exchange
- Prioritizare inteligentă în funcție de nivelul resurselor din magazie
- Calcul automat al cantității cumpărate
- Evită cumpărarea dacă magazia este aproape plină
- Suport pentru lemn, argilă și fier
- Selectare individuală a resurselor active
- Detectare stoc prin Observer sau Polling
- Refresh automat la interval randomizat
- Navigare intermediară între pagini pentru comportament mai natural
- Pauze lungi opționale
- Mod „Blocare pe târg” pentru rămânerea fixă pe Premium Exchange
- 4 moduri de viteză: Lent, Normal, Rapid și Turbo
- Panou de control dark-style integrat în pagină
- Log în timp real
- Notificări vizuale după cumpărare
- Salvarea setărilor în `localStorage`
- Shortcut `CTRL + M` pentru afișarea panoului

## Cum funcționează

Scriptul citește automat:

- resursele existente în sat;
- capacitatea maximă a magaziei;
- stocul disponibil în Premium Exchange;
- pragul maxim până la care poate umple magazia;
- resursele active selectate de utilizator.

Pe baza acestor date, stabilește ordinea de cumpărare și prioritizează resursele cu cel mai mic procent de umplere în magazie.

Exemplu:

```txt
Lemn:   40% magazie
Argilă: 75% magazie
Fier:   30% magazie
