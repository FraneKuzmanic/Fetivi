# Recorded weather responses

Real responses from DHMZ and MET Norway, fetched once on **2026-10-22 at 20:28:08 UTC** (22:28 in Zagreb). The weather tests run on these files and never reach the network. Tests pin the clock to the recording (`WEATHER_RECORDED_AT` in `src/testing/weather.ts`).

| File | Source |
| --- | --- |
| `more_n.xml` | DHMZ sea temperature, `https://vrijeme.hr/more_n.xml` |
| `uvi.xml` | DHMZ UV index, `https://vrijeme.hr/uvi.xml` |
| `cap_hr_today.xml`, `cap_hr_tomorrow.xml`, `cap_hr_day_after_tomorrow.xml` | DHMZ CAP warnings, `https://meteo.hr/upozorenja/cap_hr_<day>.xml` |
| `metno-trogir.json` | MET Norway Locationforecast 2.0 `compact` for Trogir (43.52, 16.25) |

The XML files are byte for byte as served. `metno-trogir.json` keeps only the `timeseries` steps up to 2026-10-26T18:00Z (five civil days in Zagreb, including the 25 October DST change), and it was then formatted with Biome.

What the recording holds: a yellow bura warning for Middle Dalmatia (HR805) in force until midnight, an expired one for Istria (HR028), and a yellow thunderstorm warning for Splitsko-dalmatinska (HR027) on 24 October. There are green infos, which are never shown, and NUTS3 geocodes, which are not EMMA_IDs. In October DHMZ reports UV only at Opatija, Malinska and Crikvenica. No file is doctored.

## Re-recording

```bash
cd packages/domain/src/weather/recorded
curl -s https://vrijeme.hr/more_n.xml -o more_n.xml
curl -s https://vrijeme.hr/uvi.xml -o uvi.xml
for d in today tomorrow day_after_tomorrow; do curl -s https://meteo.hr/upozorenja/cap_hr_$d.xml -o cap_hr_$d.xml; done
curl -s -A "Fetivi/0.1 (+https://github.com/FraneKuzmanic/Fetivi)" "https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=43.52&lon=16.25" -o metno-trogir.json
```

Then trim `metno-trogir.json` to about four days, run `pnpm biome format --write` on it, update `WEATHER_RECORDED_AT` and the date above, and update the expected values in the tests.

## Licences

- DHMZ data: DHMZ Open Licence. The only condition is naming DHMZ (Državni hidrometeorološki zavod, meteo.hr) as the source.
- MET Norway data: CC BY 4.0, credit "MET Norway".
