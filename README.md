# ADS-B receiver card

Home Assistant dashboard card for the state of an ADS-B receiver. It shows whether the receiver hears anything, the
aircraft it tracks over the last day, its range, its signal against the noise, and the status of other feeders.

[![GitHub Release][releases-shield]][releases] [![GitHub Release Date][release-date-shield]][releases] [![HACS][hacs-shield]][hacs] [![License][license-shield]](LICENSE)

<p>
<img src="https://raw.githubusercontent.com/jesmak/adsb-receiver-card/main/docs/images/full-light.png#gh-light-mode-only" width="400" alt="A receiver hearing 184.6 messages a second, tracking 7 aircraft, 5 of them with a position, with a range of 138 km, a curve of the last day that dips at night, its signal well above the noise, and Flightradar24 connected with 5 aircraft">
<img src="https://raw.githubusercontent.com/jesmak/adsb-receiver-card/main/docs/images/full-dark.png#gh-dark-mode-only" width="400" alt="A receiver hearing 184.6 messages a second, tracking 7 aircraft, 5 of them with a position, with a range of 138 km, a curve of the last day that dips at night, its signal well above the noise, and Flightradar24 connected with 5 aircraft">
<img src="https://raw.githubusercontent.com/jesmak/adsb-receiver-card/main/docs/images/compact-light.png#gh-light-mode-only" width="400" alt="The same receiver on one row, receiving, with 7 aircraft tracked, 5 with a position, 184.6 messages a second and a small curve of the last day">
<img src="https://raw.githubusercontent.com/jesmak/adsb-receiver-card/main/docs/images/compact-dark.png#gh-dark-mode-only" width="400" alt="The same receiver on one row, receiving, with 7 aircraft tracked, 5 with a position, 184.6 messages a second and a small curve of the last day">
</p>

## What is it?

A custom card for the receivers of [ADS-B Live](https://github.com/jesmak/adsb_live), the integration for a readsb
receiver of your own. You pick the receiver, and the card finds its sensors by itself. The aircraft themselves are drawn
on a map by [map-feed-card](https://github.com/jesmak/map-feed-card). This card is about the antenna.

An antenna that hears nothing looks the same as an empty sky, so the card puts the numbers that tell them apart in one
place: messages and positions coming in, the aircraft tracked with and without a position, the longest range of the
last quarter of an hour, and how far the signal rises above the noise. A curve of the aircraft tracked over the last day
shows whether a quiet moment is the time of day or something new.

Most receivers also feed Flightradar24 or another network through a feeder of its own, such as fr24feed. Its status can
be added as rows under the receiver, from whatever entities you have for it.

The compact layout puts the receiver on one row with a small curve, for a corner of another view.

It needs ADS-B Live 1.1.0 or newer, which has the aircraft tracked sensor.

## Installation

### With HACS

1. Add this repository to HACS custom repositories with type **Dashboard**
2. Search for ADS-B receiver card in HACS and download it
3. Refresh your browser

### Manual

1. Take `dist/adsb-receiver-card.js` from the source code of the [latest release][releases] and copy it to the
   `config/www` folder of your Home Assistant installation
2. In Home Assistant settings, open dashboards, click the three dots at the top right and open resources
3. Add a new resource with the path `/local/adsb-receiver-card.js` and type JavaScript
4. Refresh your browser

## Options

| Name         | Type    | Default  | Description                                                                                           |
| ------------ | ------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `type`       | string  | required | `custom:adsb-receiver-card`                                                                           |
| `device`     | string  | required | The receiver's device in ADS-B Live                                                                   |
| `name`       | string  |          | Replaces the receiver's name                                                                          |
| `layout`     | string  | `full`   | `full`, or `compact` for one row                                                                      |
| `feeders`    | list    |          | Other feeders' status as rows under the receiver, in `full` only                                      |
| `list_open`  | boolean | `false`  | Whether the list of aircraft heard is open when the card is shown                                     |
| `max_height` | number  |          | The most the card grows to, in pixels, with only the list of aircraft scrolling (see [Sizes](#sizes)) |

Each item of `feeders` has these keys:

| Name     | Type   | Description                                                                                                                                                                                         |
| -------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entity` | string | Whether the feeder is up. Its state is shown, with a green dot when it is on or connected, red when it is off or disconnected. A problem binary sensor reads the other way round, red when it is on |
| `name`   | string | Replaces the entity's name                                                                                                                                                                          |
| `detail` | string | A second entity whose state is shown after the first, such as the aircraft the feeder reports                                                                                                       |

Everything can be set in the card's visual editor, where the device picker offers only receivers.

## What it shows

- **The status.** Receiving, in green, while positions come in. Quiet, in grey, when none do. That is usually an empty
  sky, and an aircraft heard without a position counts as quiet too, as it may simply not send one. Unavailable, in
  red, when the positions sensor is unavailable or disabled, as it is when ADS-B Live can't reach readsb. The numbers,
  the curve, the meter and the list of aircraft are then left out.
- **Messages per second and positions per minute** under the status, and the receiver's readsb version.
- **The aircraft tracked**, with a position or without, how many of them have a position, and the longest range in the
  last 15 minutes. Clicking a number opens its sensor.
- **The curve** of aircraft tracked over the last 24 hours, from Home Assistant's long-term statistics, each hour's
  mean with the present value at the end. The peak under it is the most tracked at once. A curve's top is never below
  4, so a sky of one aircraft doesn't look as full as a busy one. A receiver added in the last hour has only the
  present value, shown as a dot at the end.
- **Signal and noise** on a meter from −50 to 0 dBFS, the gap between them shaded. A signal close to the noise means
  the antenna hears little. After a minute without messages the signal is unknown and only the noise is shown. A
  receiver that gets its messages over the network rather than from a radio of its own has neither, and no meter.
- **The aircraft heard**, a list folded under the meter. It holds the aircraft the receiver itself has heard in the last
  minute, never those only adsb.fi adds to a map, heard last first. Each row has the aircraft's callsign, or its
  registration or address, and type, its altitude, its ground speed, how long ago it was heard, and its signal on the
  meter's scale. One without a position is dimmed. The list is read from ADS-B Live every 10 seconds, and only while it
  is open.
- **The feeders**, a row each.

In the compact layout the row shows the status, the aircraft tracked, those with a position and the messages per
second, with the curve on the right. Clicking it opens the aircraft tracked sensor. It has no list of aircraft.

## Sizes

In a sections view the card takes a whole section by default and can be made as narrow as half of one. On a narrow
card the readsb version goes under the rates, and a label too long for its column wraps. In the compact layout the
curve is left out below 280 px, so the texts keep their room.

An open list of aircraft makes the card as tall as the list. With `max_height` the card grows to that many pixels at
most and only the list scrolls inside it. In a sections view, rows set to a number give the card its height instead,
and the list scrolls inside that.

<img src="https://raw.githubusercontent.com/jesmak/adsb-receiver-card/main/docs/images/quiet-narrow-light.png#gh-light-mode-only" width="260" alt="A quiet receiver on a card half a section wide, tracking one aircraft without a position after one 143 km away, its version under the rates and its range label on two lines">
<img src="https://raw.githubusercontent.com/jesmak/adsb-receiver-card/main/docs/images/quiet-narrow-dark.png#gh-dark-mode-only" width="260" alt="A quiet receiver on a card half a section wide, tracking one aircraft without a position after one 143 km away, its version under the rates and its range label on two lines">

## Examples

### The receiver with Flightradar24

fr24feed's own status page, `monitor.json` on port 8754, can be read into Home Assistant with a REST sensor, and its
`feed_status` turned into a connectivity binary sensor.

```yaml
type: custom:adsb-receiver-card
device: 0123456789abcdef0123456789abcdef
feeders:
  - entity: binary_sensor.fr24feed_link
    name: Flightradar24
    detail: sensor.fr24feed_reported_aircraft
```

### One row on another view

```yaml
type: custom:adsb-receiver-card
device: 0123456789abcdef0123456789abcdef
layout: compact
```

Device ids are easiest to pick in the visual editor.

## Data

The values come from ADS-B Live's sensors, and the curve from Home Assistant's own statistics of them. The card itself
fetches nothing from outside Home Assistant.

## Translating

The card's texts are in `src/localize/languages/`, one JSON file per language, named by its language code, such as
`en.json` and `fi.json`. To add a language, copy `en.json` to the new language's code, such as `sv.json`, and
translate the values. Nothing else needs changing. The card finds the file by itself and uses it when Home Assistant
is set to that language. A text left out falls back to English. A feeder's state comes from Home Assistant's own
translations.

## Development

Requires Node 22.13 or newer.

```
npm install
npm run check
```

`npm run check` typechecks, lints, checks formatting, runs the tests and builds `dist/adsb-receiver-card.js`, which
is the file HACS installs and is committed to the repository.

| Path                        | What it contains                                                                  |
| --------------------------- | --------------------------------------------------------------------------------- |
| `src/adsb-receiver-card.ts` | The card itself                                                                   |
| `src/editor.ts`             | The visual editor                                                                 |
| `src/receiver.ts`           | Finding a receiver's sensors, the status, the meter, a feeder's dot and the curve |
| `src/history.ts`            | Reading the curve's statistics from the recorder                                  |
| `src/const.ts`              | The sensors, the curve's hours and the meter's scale                              |
| `src/localize/languages/`   | The card's texts, one JSON file per language                                      |
| `docs/screenshots.json`     | The made-up data the README's screenshots are taken from                          |
| `tests/`                    | Tests, run with vitest                                                            |

## Support

Hey dude! Help me out for a couple of :beers: or a :coffee:!

[![coffee](https://www.buymeacoffee.com/assets/img/custom_images/black_img.png)](https://www.buymeacoffee.com/jesmak)

## License

MIT, see [LICENSE](LICENSE).

[releases-shield]: https://img.shields.io/github/release/jesmak/adsb-receiver-card.svg?style=for-the-badge
[release-date-shield]: https://img.shields.io/github/release-date/jesmak/adsb-receiver-card?style=for-the-badge
[releases]: https://github.com/jesmak/adsb-receiver-card/releases
[hacs-shield]: https://img.shields.io/badge/HACS-Custom-orange.svg?style=for-the-badge
[hacs]: https://hacs.xyz/docs/faq/custom_repositories/
[license-shield]: https://img.shields.io/github/license/jesmak/adsb-receiver-card.svg?style=for-the-badge
