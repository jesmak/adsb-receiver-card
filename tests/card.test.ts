import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../src/adsb-receiver-card";
import type { AdsbReceiverCard } from "../src/adsb-receiver-card";
import { HISTORY_REFRESH_MS } from "../src/const";
import { compactFeeders } from "../src/editor";
import type { HomeAssistant } from "../src/hass";
import type { AdsbReceiverCardConfig } from "../src/types";
import { RECEIVER, SENSOR_IDS, entity, hass } from "./fixtures";

const NOW = Date.parse("2026-10-14T07:40:00Z");

async function card(state: HomeAssistant, config: Partial<AdsbReceiverCardConfig> = {}): Promise<AdsbReceiverCard> {
    const element = document.createElement("adsb-receiver-card");
    element.setConfig({ type: "custom:adsb-receiver-card", device: RECEIVER, ...config } as AdsbReceiverCardConfig);
    element.hass = state;
    document.body.append(element);
    await element.updateComplete;
    return element;
}

function text(element: Element | null | undefined): string {
    return (element?.textContent ?? "").replace(/\s+/g, " ").trim();
}

const FEEDERS = [
    entity("binary_sensor.fr24_link", "on", { friendly_name: "Linkki", device_class: "connectivity" }),
    entity("sensor.fr24_reported", "5", { unit_of_measurement: "lentoalusta" }),
];

describe("adsb-receiver-card", () => {
    beforeEach(() => {
        vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    });

    afterEach(() => {
        vi.useRealTimers();
        document.body.innerHTML = "";
    });

    it("shows the receiver's state, its figures, the meter and a feeder", async () => {
        const element = await card(hass({}, FEEDERS), {
            feeders: [{ entity: "binary_sensor.fr24_link", name: "Flightradar24", detail: "sensor.fr24_reported" }],
        });
        const root = element.shadowRoot!;
        expect(root.querySelector("ha-card")?.classList.contains("receiving")).toBe(true);
        expect(text(root.querySelector(".name"))).toBe("ADS-B");
        expect(text(root.querySelector(".status"))).toBe("Kuulee");
        expect(text(root.querySelector(".rates"))).toBe("184,6 viestiä/s, 142 sijaintia/min");
        expect(text(root.querySelector(".version"))).toBe("readsb 3.16.17");
        expect([...root.querySelectorAll(".figure")].map(text)).toEqual(["7 seurannassa", "5 sijainnilla", "138 km kantama, 15 min"]);
        expect(text(root.querySelector(".levels"))).toBe("Kohina −39,6 dBFS Signaali −18,2 dBFS");
        expect(text(root.querySelector(".feeder"))).toBe("Flightradar24 Yhdistetty, 5 lentoalusta");
        expect(root.querySelector(".feeder .dot")?.classList.contains("ok")).toBe(true);
    });

    it("writes one position a minute in the singular", async () => {
        const element = await card(hass({ positions_per_minute: "1" }));
        expect(text(element.shadowRoot!.querySelector(".rates"))).toBe("184,6 viestiä/s, 1 sijainti/min");
    });

    it("is quiet in grey when nothing comes with a position", async () => {
        const element = await card(hass({ positions_per_minute: "0", aircraft_with_position: "0", aircraft_tracked: "1" }));
        const root = element.shadowRoot!;
        expect(root.querySelector("ha-card")?.classList.contains("quiet")).toBe(true);
        expect(text(root.querySelector(".status"))).toBe("Hiljaista");
        expect(text(root.querySelector(".figure"))).toBe("1 seurannassa");
    });

    // What each layout shows in each status. An unavailable receiver keeps only what doesn't come from its sensors: its name
    // and status, and in the full layout its version and feeders.
    const PARTS = [".rates", ".version", ".figures", ".curve", ".meter", ".feeder", ".line", ".small-curve"];
    describe("each layout in each status", () => {
        const FULL = [".rates", ".version", ".figures", ".curve", ".meter", ".feeder"];
        const COMPACT = [".line", ".small-curve"];
        // Unavailable means the positions sensor is unavailable or isn't there, whatever the other sensors say.
        const everything = Object.fromEntries(Object.keys(SENSOR_IDS).map((key) => [key, "unavailable"]));
        const VALUES: Record<string, Partial<Record<keyof typeof SENSOR_IDS, string>>> = {
            receiving: { positions_per_minute: "142" },
            quiet: { positions_per_minute: "0" },
            "all unavailable": everything,
            "only it unavailable": { positions_per_minute: "unavailable" },
            "only it receiving": { ...everything, positions_per_minute: "142" },
            missing: {},
            "without a state": {},
        };
        it.each([
            { layout: "full", positions: "receiving", status: "Kuulee", shown: FULL },
            { layout: "full", positions: "quiet", status: "Hiljaista", shown: FULL },
            { layout: "full", positions: "all unavailable", status: "Ei saatavilla", shown: [".version", ".feeder"] },
            { layout: "full", positions: "only it unavailable", status: "Ei saatavilla", shown: [".version", ".feeder"] },
            { layout: "full", positions: "missing", status: "Ei saatavilla", shown: [".version", ".feeder"] },
            { layout: "full", positions: "without a state", status: "Ei saatavilla", shown: [".version", ".feeder"] },
            // Without noise the meter has nothing to compare with, so it is left out.
            {
                layout: "full",
                positions: "only it receiving",
                status: "Kuulee",
                shown: [".rates", ".version", ".figures", ".curve", ".feeder"],
            },
            { layout: "compact", positions: "receiving", status: "Kuulee", shown: COMPACT },
            { layout: "compact", positions: "quiet", status: "Hiljaista", shown: COMPACT },
            { layout: "compact", positions: "all unavailable", status: "Ei saatavilla", shown: [] },
            { layout: "compact", positions: "only it unavailable", status: "Ei saatavilla", shown: [] },
            { layout: "compact", positions: "missing", status: "Ei saatavilla", shown: [] },
            { layout: "compact", positions: "without a state", status: "Ei saatavilla", shown: [] },
            { layout: "compact", positions: "only it receiving", status: "Kuulee", shown: COMPACT },
        ])("in the $layout layout with positions $positions shows $shown", async ({ layout, positions, status, shown }) => {
            const state = hass(VALUES[positions], FEEDERS);
            if (positions === "missing") {
                delete state.entities![SENSOR_IDS.positions_per_minute];
            }
            if (positions === "without a state") {
                delete state.states[SENSOR_IDS.positions_per_minute];
            }
            const element = await card(state, {
                layout: layout as AdsbReceiverCardConfig["layout"],
                feeders: [{ entity: "binary_sensor.fr24_link" }],
            });
            const root = element.shadowRoot!;
            expect(text(root.querySelector(".name"))).toBe(`ADS-B${layout === "compact" ? ` ${status}` : ""}`);
            expect(text(root.querySelector(".status"))).toBe(status);
            expect(PARTS.filter((part) => root.querySelector(part))).toEqual(shown);
            if (shown.includes(".version")) {
                expect(text(root.querySelector(".version"))).toBe("readsb 3.16.17");
            }
        });
    });

    // The dot of the present value alone means the recorder has no hour yet, so the curve waits for the recorder's answer.
    // A refresh that fails keeps the curve the card has, and one that answers replaces it.
    describe("the curve before and after its statistics", () => {
        const NOTHING = { full: "", small: "", lone: false, peak: "" };
        const LONE = { full: "M360.0,22.0L360.0,22.0", small: "M90.0,16.0L90.0,16.0", lone: true, peak: "huippu 2" };
        const HOUR = { full: "M180.0,1.0L360.0,22.0", small: "M45.0,1.0L90.0,16.0", lone: false, peak: "huippu 4" };
        it.each([
            { answers: ["pending"], ...NOTHING },
            { answers: ["failed"], ...NOTHING },
            { answers: ["no hours"], ...LONE },
            { answers: ["an hour"], ...HOUR },
            { answers: ["an hour", "failed"], ...HOUR },
            { answers: ["an hour", "no hours"], ...LONE },
            { answers: ["failed", "an hour"], ...HOUR },
            { answers: ["no hours", "an hour"], ...HOUR },
            { answers: ["no hours", "failed"], ...LONE },
        ])("is drawn from the recorder's answers $answers", async ({ answers, full, small, lone, peak }) => {
            vi.useRealTimers();
            vi.useFakeTimers({ now: NOW, toFake: ["Date", "setInterval", "clearInterval"] });
            const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
            const draw = async (layout: AdsbReceiverCardConfig["layout"]) => {
                const state = hass({ aircraft_tracked: "2" });
                let call = 0;
                state.callWS = (async () => {
                    const answer = answers[Math.min(call++, answers.length - 1)];
                    if (answer === "pending") {
                        return new Promise(() => undefined);
                    }
                    if (answer === "failed") {
                        throw new Error("the websocket closed");
                    }
                    const hour = { start: Date.now() - 12.5 * 3_600_000, mean: 4, max: 4 };
                    return { [SENSOR_IDS.aircraft_tracked]: answer === "an hour" ? [hour] : [] };
                }) as HomeAssistant["callWS"];
                const element = await card(state, { layout });
                for (let refresh = 1; refresh < answers.length; refresh++) {
                    await vi.advanceTimersByTimeAsync(HISTORY_REFRESH_MS);
                }
                await new Promise((resolve) => setTimeout(resolve, 0));
                await element.updateComplete;
                return element.shadowRoot!;
            };

            const fullCard = await draw("full");
            const drawn = fullCard.querySelector(".curve path");
            expect(drawn?.getAttribute("d")).toBe(full);
            expect(drawn?.classList.contains("lone")).toBe(lone);
            expect([...fullCard.querySelectorAll(".caption span")].map(text)).toEqual(["24 h sitten", peak, "nyt"]);

            document.body.innerHTML = "";
            const drawnSmall = (await draw("compact")).querySelector(".small-curve path");
            expect(drawnSmall?.getAttribute("d")).toBe(small);
            expect(drawnSmall?.classList.contains("lone")).toBe(lone);
            warn.mockRestore();
        });
    });

    // Every number the card writes follows the number format, the ones inside its texts too. Persian has digits of its own.
    describe("the numbers in the texts", () => {
        it.each([
            { language: "fi", number_format: undefined, past: "24 h sitten", peak: "huippu 4", range: "kantama, 15 min" },
            { language: "fa", number_format: undefined, past: "۲۴ h ago", peak: "peak ۴", range: "range, ۱۵ min" },
            { language: "fa", number_format: "language", past: "۲۴ h ago", peak: "peak ۴", range: "range, ۱۵ min" },
            { language: "fa", number_format: "none", past: "24 h ago", peak: "peak 4", range: "range, 15 min" },
            { language: "fa", number_format: "comma_decimal", past: "24 h ago", peak: "peak 4", range: "range, 15 min" },
        ])(
            "are written in the language $language with the format $number_format",
            async ({ language, number_format, past, peak, range }) => {
                const state = { ...hass({ aircraft_tracked: "2" }), locale: { language, number_format } };
                state.callWS = (async () => ({
                    [SENSOR_IDS.aircraft_tracked]: [{ start: NOW - 12.5 * 3_600_000, mean: 4, max: 4 }],
                })) as HomeAssistant["callWS"];
                const element = await card(state);
                await new Promise((resolve) => setTimeout(resolve, 0));
                await element.updateComplete;
                const root = element.shadowRoot!;
                const caption = [...root.querySelectorAll(".caption span")].map(text);
                expect([caption[0], caption[1]]).toEqual([past, peak]);
                // The no-break space keeps the minutes and "min" together when the narrow card breaks the label.
                const label = root.querySelectorAll(".figure .label")[2]?.textContent?.trim();
                expect(label).toBe(range.replace(" min", "\u00a0min"));
            },
        );
    });

    it("of an older ADS-B Live shows a dash for the aircraft tracked, and no curve", async () => {
        const state = hass();
        delete state.entities![SENSOR_IDS.aircraft_tracked];
        const full = await card(state);
        expect(text(full.shadowRoot!.querySelector(".figure"))).toBe("– seurannassa");
        expect(full.shadowRoot!.querySelector(".curve")).toBeNull();

        document.body.innerHTML = "";
        const compact = await card(state, { layout: "compact" });
        expect(text(compact.shadowRoot!.querySelector(".line"))).toBe("– seurannassa, 5 sijainnilla, 184,6 viestiä/s");
        expect(compact.shadowRoot!.querySelector(".small-curve")).toBeNull();
    });

    it("says when a signal is unknown, and leaves the meter out without noise", async () => {
        const element = await card(hass({ signal: "unknown" }));
        expect(text(element.shadowRoot!.querySelector(".levels"))).toBe("Kohina −39,6 dBFS Signaali ei tiedossa");
        expect(element.shadowRoot!.querySelector(".mark.signal")).toBeNull();

        document.body.innerHTML = "";
        const networked = await card(hass({ signal: "unknown", noise: "unknown" }));
        expect(networked.shadowRoot!.querySelector(".meter")).toBeNull();
    });

    describe("the entities a feeder names", () => {
        it.each([
            { entity: "binary_sensor.fr24_link", detail: undefined, row: "Linkki Yhdistetty" },
            { entity: "binary_sensor.fr24_link", detail: "sensor.fr24_reported", row: "Linkki Yhdistetty, 5 lentoalusta" },
            { entity: "binary_sensor.fr24_link", detail: "sensor.missing", row: "Linkki Yhdistetty, Entiteettiä sensor.missing ei löydy" },
            { entity: "binary_sensor.missing", detail: undefined, row: "binary_sensor.missing Entiteettiä binary_sensor.missing ei löydy" },
            {
                entity: "binary_sensor.missing",
                detail: "sensor.fr24_reported",
                row: "binary_sensor.missing Entiteettiä binary_sensor.missing ei löydy, 5 lentoalusta",
            },
            {
                entity: "binary_sensor.missing",
                detail: "sensor.missing",
                row: "binary_sensor.missing Entiteettiä binary_sensor.missing ei löydy, Entiteettiä sensor.missing ei löydy",
            },
        ])("shows a feeder of $entity with $detail as its states, or says which entity isn't there", async ({ entity, detail, row }) => {
            const element = await card(hass({}, FEEDERS), { feeders: [{ entity, detail }] });
            expect(text(element.shadowRoot!.querySelector(".feeder"))).toBe(row);
        });
    });

    it("says so when the device doesn't exist or isn't a receiver", async () => {
        const missing = await card(hass(), { device: "nothing0001" });
        expect(text(missing.shadowRoot!.querySelector("ha-card"))).toBe("Vastaanotinta ei löydy");

        document.body.innerHTML = "";
        const state = hass();
        state.devices!["lamp0001"] = { id: "lamp0001", name: "Lamp" };
        const lamp = await card(state, { device: "lamp0001" });
        expect(text(lamp.shadowRoot!.querySelector("ha-card"))).toBe("Vastaanotinta ei löydy");
    });

    // What makes the card draw itself again: anything it formats with, and the states it shows, but no other state.
    describe("what draws the card again", () => {
        it.each([
            {
                change: "the locale",
                next: (state: HomeAssistant) => ({ ...state, locale: { language: "fi", number_format: "comma_decimal" } }),
                redraw: true,
            },
            { change: "the language", next: (state: HomeAssistant) => ({ ...state, language: "en" }), redraw: true },
            {
                change: "the entity registry",
                next: (state: HomeAssistant) => ({ ...state, entities: { ...state.entities } }),
                redraw: true,
            },
            { change: "the device registry", next: (state: HomeAssistant) => ({ ...state, devices: { ...state.devices } }), redraw: true },
            {
                change: "the state formatter",
                next: (state: HomeAssistant) => ({ ...state, formatEntityState: () => "Yhdistetty" }),
                redraw: true,
            },
            { change: "a receiver's sensor", next: (state: HomeAssistant) => withState(state, SENSOR_IDS.signal, "-20.0"), redraw: true },
            { change: "a feeder", next: (state: HomeAssistant) => withState(state, "binary_sensor.fr24_link", "off"), redraw: true },
            { change: "a feeder's detail", next: (state: HomeAssistant) => withState(state, "sensor.fr24_reported", "6"), redraw: true },
            { change: "another entity", next: (state: HomeAssistant) => withState(state, "light.kitchen", "on"), redraw: false },
        ])("draws itself again when $change changes: $redraw", async ({ next, redraw }) => {
            const state = hass({}, FEEDERS);
            const element = await card(state, {
                feeders: [{ entity: "binary_sensor.fr24_link", detail: "sensor.fr24_reported" }],
            });
            element.hass = next(state);
            const changed = new Map<PropertyKey, unknown>([["hass", state]]);
            expect((element as unknown as { shouldUpdate(changed: Map<PropertyKey, unknown>): boolean }).shouldUpdate(changed)).toBe(
                redraw,
            );
        });
    });

    it("forgets the last receiver's curve when another is picked", async () => {
        const state = hass({ aircraft_tracked: "2" });
        state.entities!["sensor.second_tracked"] = {
            entity_id: "sensor.second_tracked",
            device_id: "receiver0002",
            platform: "adsb_live",
            translation_key: "aircraft_tracked",
        };
        state.entities!["sensor.second_positions"] = {
            entity_id: "sensor.second_positions",
            device_id: "receiver0002",
            platform: "adsb_live",
            translation_key: "positions_per_minute",
        };
        state.states["sensor.second_tracked"] = entity("sensor.second_tracked", "2");
        state.states["sensor.second_positions"] = entity("sensor.second_positions", "0");
        state.devices!["receiver0002"] = { id: "receiver0002", name: "Toinen", manufacturer: "readsb" };
        state.callWS = (async (message: Record<string, unknown>) =>
            (message.statistic_ids as string[])[0] === SENSOR_IDS.aircraft_tracked
                ? { [SENSOR_IDS.aircraft_tracked]: [{ start: NOW - 12.5 * 3_600_000, mean: 4, max: 6 }] }
                : new Promise(() => undefined)) as HomeAssistant["callWS"];
        const element = await card(state);
        await vi.waitFor(() => expect(text(element.shadowRoot!.querySelector(".caption"))).toBe("24 h sitten huippu 6 nyt"));

        element.setConfig({ type: "custom:adsb-receiver-card", device: "receiver0002" } as AdsbReceiverCardConfig);
        await element.updateComplete;
        await element.updateComplete;
        expect(text(element.shadowRoot!.querySelector(".caption"))).toBe("24 h sitten nyt");
        // Nothing of the first receiver is left while the second one's statistics are on the way.
        expect(element.shadowRoot!.querySelector(".curve path")?.getAttribute("d")).toBe("");
    });

    it("puts the same on one row in the compact layout, without the feeders", async () => {
        const element = await card(hass({}, FEEDERS), { layout: "compact", feeders: [{ entity: "binary_sensor.fr24_link" }] });
        const root = element.shadowRoot!;
        expect(text(root.querySelector(".name"))).toBe("ADS-B Kuulee");
        expect(text(root.querySelector(".line"))).toBe("7 seurannassa, 5 sijainnilla, 184,6 viestiä/s");
        expect(root.querySelector(".small-curve")).not.toBeNull();
        expect(root.querySelector(".feeder")).toBeNull();
    });

    it("opens a figure's sensor when it is tapped", async () => {
        const element = await card(hass());
        const opened: string[] = [];
        element.addEventListener("hass-more-info", (event) => opened.push((event as CustomEvent<{ entityId: string }>).detail.entityId));
        element.shadowRoot!.querySelector<HTMLButtonElement>(".figure")!.click();
        expect(opened).toEqual([SENSOR_IDS.aircraft_tracked]);
    });

    it("draws the curve from the recorder's hourly statistics", async () => {
        const state = hass({ aircraft_tracked: "2" });
        const asked: Array<Record<string, unknown>> = [];
        state.callWS = (async (message: Record<string, unknown>) => {
            asked.push(message);
            return {
                [SENSOR_IDS.aircraft_tracked]: [
                    { start: NOW - 23.5 * 3_600_000, mean: 0, max: 1 },
                    { start: NOW - 12.5 * 3_600_000, mean: 4, max: 6 },
                ],
            };
        }) as HomeAssistant["callWS"];
        const element = await card(state);
        await vi.waitFor(() => expect(text(element.shadowRoot!.querySelector(".caption"))).toBe("24 h sitten huippu 6 nyt"));
        expect(asked[0]).toMatchObject({
            type: "recorder/statistics_during_period",
            statistic_ids: [SENSOR_IDS.aircraft_tracked],
            period: "hour",
        });
        expect(element.shadowRoot!.querySelector(".curve path")?.getAttribute("d")).toBe("M15.0,43.0L180.0,15.0L360.0,29.0");
        expect(element.shadowRoot!.querySelector(".curve path")?.classList.contains("lone")).toBe(false);
    });

    it("refuses a configuration without a receiver", () => {
        const element = document.createElement("adsb-receiver-card");
        expect(() => element.setConfig({ type: "custom:adsb-receiver-card" } as AdsbReceiverCardConfig)).toThrow("Invalid configuration");
    });
});

function withState(state: HomeAssistant, id: string, value: string): HomeAssistant {
    return { ...state, states: { ...state.states, [id]: entity(id, value) } };
}

describe("the editor", () => {
    // The defaults and empty fields are shown in the form but left out of what it saves.
    describe("what the editor saves", () => {
        it.each([
            {
                case: "the default layout and empty fields",
                form: { type: "custom:adsb-receiver-card", device: RECEIVER, layout: "full", name: "", feeders: [] },
                saved: { type: "custom:adsb-receiver-card", device: RECEIVER },
            },
            {
                case: "no layout at all",
                form: { type: "custom:adsb-receiver-card", device: RECEIVER },
                saved: { type: "custom:adsb-receiver-card", device: RECEIVER },
            },
            {
                case: "the compact layout and a name",
                form: { type: "custom:adsb-receiver-card", device: RECEIVER, layout: "compact", name: "Katto" },
                saved: { type: "custom:adsb-receiver-card", device: RECEIVER, layout: "compact", name: "Katto" },
            },
            {
                case: "a feeder with empty fields",
                form: {
                    type: "custom:adsb-receiver-card",
                    device: RECEIVER,
                    feeders: [{ entity: "binary_sensor.fr24_link", name: "", detail: "" }],
                },
                saved: { type: "custom:adsb-receiver-card", device: RECEIVER, feeders: [{ entity: "binary_sensor.fr24_link" }] },
            },
        ])("saves $case as only what is set", async ({ form, saved }) => {
            const editor = document.createElement("adsb-receiver-card-editor");
            const configs: unknown[] = [];
            editor.addEventListener("config-changed", (event) => configs.push((event as CustomEvent<{ config: unknown }>).detail.config));
            (editor as unknown as { valueChanged(event: CustomEvent): void }).valueChanged(
                new CustomEvent("value-changed", { detail: { value: form } }),
            );
            expect(configs).toEqual([saved]);
        });
    });

    it("keeps only what is filled in for a feeder, and drops a feeder without its entity", () => {
        expect(
            compactFeeders([
                { entity: "binary_sensor.fr24_link", name: "", detail: "sensor.fr24_reported" },
                { entity: "", name: "Empty" },
            ]),
        ).toEqual([{ entity: "binary_sensor.fr24_link", detail: "sensor.fr24_reported" }]);
    });
});
