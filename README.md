# RailNavigator CZ 0.7.0

Mobilní testovací PWA pro GitHub Pages. Používá GPS telefonu, Leaflet, OpenRailwayMap a pro určení nejbližší koleje umí přednostně využít lokální výřez veřejných dat ČÚZK/DMVS. Když výřez DMVS není přítomen nebo dané místo nepokrývá, automaticky použije OpenStreetMap přes Overpass API.

V oblastech pokrytých DMVS aplikace používá přesnou geometrii ČÚZK a za běhu ji opatrně doplňuje o označení a chybějící vlečky z OpenStreetMap. Původ geometrie a označení zůstává v diagnostickém záznamu oddělený.

Verze 0.7.0 sjednocuje polohu ikony, vybranou kolej a diagnostický záznam. Výběr koleje používá historii, směr, přesnost GPS, rychlost a adaptivní potvrzení změny. Při potvrzeném stání uzamkne ikonu i rychlost, ale surové GPS body dále ukládá.

Rozpracovaný záznam jízdy se průběžně ukládá do IndexedDB a po návratu z hovoru, ukončení aplikace nebo obnovení stránky se automaticky obnoví. CSV nově obsahuje surovou, filtrovanou i přichycenou polohu, kandidátní koleje, všechny rychlosti, důvody rozhodnutí, síťový stav a uživatelské poznámky.

## Nasazení na GitHub Pages

V kořeni repozitáře mají být pouze tyto projektové položky:

```text
index.html
manifest.json
service-worker.js
README.md
DATA-SOURCES.md
css/style.css
js/app.js
js/dmvs.js
js/railway.js
js/gps.js
data/README.md
```

Případné duplicitní `style.css`, `app.js` nebo `gps.js` v kořeni smažte. GitHub Pages nastavte na větev `main` a složku `/ (root)`.

## Data DMVS

Aplikace obsahuje optimalizovaný soubor `data/dmvs-railways.geojson` pro trasu Brno-Maloměřice – Modřice. Pokrytí zahrnuje Maloměřice a Obřany, Židenice, Černovice, Brno-střed, Brno-jih a Modřice. Jeho formát a licenční metadata popisuje `data/README.md`. Původní ZIP/JVF balíčky se do webu nevkládají.

Právní původ a povinnou atribuci popisuje `DATA-SOURCES.md`.

## Omezení

Jde o orientační testovací nástroj, nikoli o schválený železniční provozní systém. Veřejná data DMVS nejsou zdrojem aktuálních výluk, provozních rychlostí ani závazných sklonových poměrů.

Telefonní GPS nemůže v hustém kolejišti zaručit absolutně přesné rozlišení sousedních kolejí. Zobrazená jistota vyjadřuje kvalitu odhadu vybrané koleje; údaj `GPS ± m` je samostatná přesnost polohy telefonu.
