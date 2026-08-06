# RailNavigator CZ 0.8.0

Mobilní testovací PWA pro GitHub Pages. Používá GPS telefonu, Leaflet, OpenRailwayMap a dva lokální železniční podklady: přesné osy kolejí ČÚZK/DMVS a výřez OpenStreetMap vytvořený z dodaného celorepublikového exportu. Určení koleje proto během jízdy nepotřebuje Overpass API ani mobilní připojení.

V oblastech pokrytých DMVS aplikace používá přesnou geometrii ČÚZK a za běhu ji opatrně doplňuje o označení a chybějící vlečky z OpenStreetMap. Původ geometrie a označení zůstává v diagnostickém záznamu oddělený.

Verze 0.7.0 sjednocuje polohu ikony, vybranou kolej a diagnostický záznam. Výběr koleje používá historii, směr, přesnost GPS, rychlost a adaptivní potvrzení změny. Při potvrzeném stání uzamkne ikonu i rychlost, ale surové GPS body dále ukládá.

Verze 0.8.0 rozšiřuje lokální pokrytí z Brna-Maloměřic do Kyjova. Přidává plynulou animaci vozidla, prostorový index ČÚZK, kratší zvýraznění vybrané koleje, rychlejší detekci rozjezdu a zastavení a desetinnou rychlost v celém rozsahu. Žlutý záznam se kreslí po přiřazené koleji.

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
data/dmvs-railways.geojson
data/osm-railways.geojson
```

Případné duplicitní `style.css`, `app.js` nebo `gps.js` v kořeni smažte. GitHub Pages nastavte na větev `main` a složku `/ (root)`.

## Data DMVS

Aplikace obsahuje optimalizovaný soubor `data/dmvs-railways.geojson` pro koridor Brno-Maloměřice – Kyjov a přilehlá kolejiště. Doplňuje jej `data/osm-railways.geojson` s označením kolejí, vlečkami a záložní geometrií. Původní ZIP/JVF balíčky ani 80MB celorepublikový export se do webu nevkládají.

Právní původ a povinnou atribuci popisuje `DATA-SOURCES.md`.

## Omezení

Jde o orientační testovací nástroj, nikoli o schválený železniční provozní systém. Veřejná data DMVS nejsou zdrojem aktuálních výluk, provozních rychlostí ani závazných sklonových poměrů.

Telefonní GPS nemůže v hustém kolejišti zaručit absolutně přesné rozlišení sousedních kolejí. Zobrazená přesnost koleje vyjadřuje kvalitu odhadu vybrané koleje; údaj `GPS ± m` je samostatná přesnost polohy telefonu.
