# Dagurinn 🗓️

Einföld skipulagssíða fyrir fjölskylduna. Hver og einn sér **daginn sinn**: skóla, æfingar, fermingarfræðslu, hvenær á að leggja af stað, hver keyrir og hvað á að taka með. Breytingar dagsins (æfing færð eða felld niður, starfsdagur) birtast efst.

- **Í dag** – „Núna“ / „Næst“ spjald með *Farðu út kl. …*, breytingar dagsins, tímalína og það sem þarf fyrir morgundaginn
- **Á morgun** – opnast sjálfkrafa eftir kl. 19 á kvöldin
- **Vikan** – næstu 7 dagar
- **Veður** – hiti og vindur, og ábending eins og „Húfa og vettlingar“ eða „Regnjakki“
- Virkar eins og app þegar síðan er vistuð á heimaskjá iPhone, líka án netsambands (sýnir þá síðustu útgáfu)

## Gögnin eru dulkóðuð 🔒

GitHub Pages síður eru opnar öllum, svo dagskráin er **dulkóðuð** (AES-256-GCM) með fjölskyldulykilorði áður en hún fer í repoið (`data/dagurinn.enc.json`). Án lykilorðsins sést bara óskiljanlegur texti. Lykilorðið fer aldrei til GitHub.

Síðan er líka merkt `noindex`, svo leitarvélar skrá hana ekki.

## Uppsetning (einu sinni, ~10 mín)

### 1. Kveikja á GitHub Pages
Í repoinu: **Settings → Pages → Source: Deploy from a branch → `main` / `(root)` → Save**.
Eftir 1–2 mín. er síðan á `https://<notandi>.github.io/dagurinn/`.

### 2. Búa til aðgangslykil (fyrir þá sem eiga að geta breytt)
1. GitHub → mynd efst til hægri → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**
2. **Token name:** `dagurinn – sími Grétars` (einn lykill á hvert tæki er þægilegast)
3. **Expiration:** t.d. 1 ár
4. **Repository access:** *Only select repositories* → `dagurinn`
5. **Permissions → Repository permissions → Contents:** *Read and write*
6. **Generate token** og afritaðu lykilinn (`github_pat_…`)

Lykillinn getur bara breytt þessu eina repoi.

### 3. Setja upp dagskrána
Opnaðu síðuna → **Setja upp dagskrá** → nafn, aðgangslykill og fjölskyldulykilorð (tvisvar). Síðan býr til dulkóðuðu skrána.

### 4. Á símana
- Opna síðuna í **Safari** → deilihnappurinn → **Bæta á heimaskjá** („Add to Home Screen“)
- Slá inn fjölskyldulykilorðið einu sinni
- Þeir sem mega breyta: ⚙︎ → **GitHub tenging** → líma inn aðgangslykil

## Hvernig er breytt?

| Hvað | Hvernig |
|---|---|
| Æfing færð / felld niður **bara í dag** | Ýta á æfinguna → *Fellur niður þennan dag* eða *Breyta tíma, skutli eða athugasemd* |
| Hver keyrir / sækir | Sama – „Hver keyrir / sækir“ |
| Stakur viðburður (tannlæknir, leikur, afmæli) | **+ Bæta við → Stakur viðburður** |
| Föst dagskrá (skóli, æfingar, fermingarfræðsla) | **+ Bæta við → Fast atriði** eða ⚙︎ → Föst dagskrá |
| Starfsdagur / jólafrí | **+ Bæta við → Frídagur** – velur hvort skóli, æfingar o.fl. falla niður |
| Staðir og ferðatími („Farðu út kl.“) | ⚙︎ → Staðir og ferðatími – t.d. *Egilshöll · 25 mín · Strætó leið 6* |
| Fólk | ⚙︎ → Fólk |

### Hver má breyta hverju?
Hver sími er stilltur undir ⚙︎ → **GitHub tenging → Þessi sími tilheyrir**:
- **Foreldri** – má breyta öllu: öllu fólki, frídögum, stöðum, innflutningi.
- **Nafn barns** – má bara bæta við og breyta *sinni eigin* dagskrá. Sér allt hitt en getur ekki breytt því.

Settu **Foreldra-PIN** (⚙︎ → Foreldra-PIN) svo barn geti ekki sjálft skipt símanum sínum yfir í „Foreldri“.
Athugið: þetta er læsing í viðmótinu, ekki fullkomin aðgangsstýring – aðgangslykillinn sjálfur getur tæknilega breytt öllu í repoinu. Allar breytingar sjást í sögu repoins (*Commits*) og hægt er að afturkalla þær. Notaðu sérstakan aðgangslykil fyrir hvern síma svo hægt sé að eyða einum án þess að hinir hætti að virka.

Breytingar vistast sjálfkrafa. Önnur tæki sjá þær eftir 1–10 mín. (eða strax með ↻).

### Flytja inn gögn
⚙︎ → **Flytja inn gögn** tekur við JSON, t.d. stundaskrá sem Claude útbýr:

```json
{
  "places": [{ "id": "holl", "name": "Egilshöll", "minutes": 25, "note": "Strætó leið 6" }],
  "weekly": [
    { "id": "fotbolti", "person": "<id manneskju>", "kind": "aefing", "icon": "⚽", "title": "Fótboltaæfing",
      "days": [2, 4], "start": "17:00", "end": "18:30", "place": "holl", "bring": ["Takkaskór", "Vatnsbrúsi"] }
  ]
}
```
Dagar: 1 = mánudagur … 7 = sunnudagur. Tegundir (`kind`): `skoli`, `aefing`, `tomstund`, `annad`.

## Sýnishorn
`https://<notandi>.github.io/dagurinn/?demo` sýnir síðuna með tilbúnum gögnum (vistast ekki).

## Næstu skref (hugmyndir)
- Sækja æfingar sjálfkrafa úr **Abler**, ef þar er hægt að fá dagatalstengil
- **Strætó**: næstu brottfarir úr opnum tímatöflugögnum Strætó (GTFS)
- Starfsdagar skólans settir inn fyrir alla önnina í einu

## Skrár
`index.html`, `style.css`, `app.js` (allt forritið), `sw.js` (offline), `manifest.webmanifest` + `icons/` (heimaskjár), `data/dagurinn.enc.json` (dulkóðuð dagskrá, verður til við uppsetningu).
