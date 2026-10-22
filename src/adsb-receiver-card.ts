/**
 * A dashboard card for the state of an ADS-B receiver from the ADS-B Live integration: whether it hears anything, the
 * aircraft it tracks and their curve over the last day, its range, its signal against the noise, and other feeders'
 * status. The compact layout puts the same on one row.
 */
import { LitElement, css, html, nothing } from "lit";
import type { CSSResultGroup, PropertyValues, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import { CARD_VERSION, HISTORY_HOURS, HISTORY_REFRESH_MS, RANGE_MINUTES } from "./const";
import type { SensorKey } from "./const";
import "./editor";
import type { HomeAssistant } from "./hass";
import { fetchStatistics } from "./history";
import type { StatisticRow } from "./history";
import { browserLanguage, translate } from "./localize/localize";
import {
    curvePoints,
    feederState,
    formatNumber,
    meter,
    receiverDevices,
    receiverName,
    receiverSensors,
    receiverStatus,
    linePath,
    peakOf,
    valueOf,
} from "./receiver";
import type { NumberFormat, Status } from "./receiver";
import type { AdsbReceiverCardConfig, FeederConfig } from "./types";

console.info(
    `%c  ADSB-RECEIVER-CARD \n%c  ${CARD_VERSION}    `,
    "color: orange; font-weight: bold; background: black",
    "color: white; font-weight: bold; background: dimgray",
);

interface CardRegistration {
    type: string;
    name: string;
    description: string;
    documentationURL?: string;
    preview?: boolean;
}

const registry = window as unknown as { customCards?: CardRegistration[] };
registry.customCards = registry.customCards ?? [];
registry.customCards.push({
    type: "adsb-receiver-card",
    name: translate(browserLanguage(), "common.name"),
    description: translate(browserLanguage(), "common.description"),
    documentationURL: "https://github.com/jesmak/adsb-receiver-card",
    preview: true,
});

const HOUR = 3_600_000;
/** The curves' boxes in SVG units. The full one stretches to the card's width. */
const CURVE = { width: 360, height: 44 };
const SMALL_CURVE = { width: 90, height: 32 };

@customElement("adsb-receiver-card")
export class AdsbReceiverCard extends LitElement {
    @property({ attribute: false }) public hass?: HomeAssistant;
    @state() private config?: AdsbReceiverCardConfig;
    @state() private history: StatisticRow[] = [];
    /** Whether the recorder has answered for the curve's sensor, so a lone present value means it has no hour yet. */
    @state() private historyLoaded = false;
    private historyOf?: string;
    private timer?: ReturnType<typeof setInterval>;

    public static getConfigElement(): HTMLElement {
        return document.createElement("adsb-receiver-card-editor");
    }

    /** Offers the first receiver there is when the card is added from the picker. */
    public static getStubConfig(hass?: HomeAssistant): Record<string, unknown> {
        return { device: hass ? (receiverDevices(hass)[0] ?? "") : "" };
    }

    public setConfig(config: AdsbReceiverCardConfig): void {
        if (!config || typeof config.device !== "string" || !config.device) {
            throw new Error(translate(browserLanguage(), "common.invalid_configuration"));
        }
        this.config = { ...config, feeders: Array.isArray(config.feeders) ? config.feeders.filter((feeder) => !!feeder?.entity) : [] };
    }

    public getCardSize(): number {
        return this.compact() ? 1 : 5 + (this.config?.feeders?.length ?? 0);
    }

    /** In a sections view the card takes a whole section by default and is never narrower than half of one. */
    public getGridOptions(): Record<string, unknown> {
        return { columns: 12, min_columns: 6, rows: "auto" };
    }

    /** The curve is read when the card comes on the page and every few minutes while it stays there. */
    public connectedCallback(): void {
        super.connectedCallback();
        this.timer = setInterval(() => void this.loadHistory(true), HISTORY_REFRESH_MS);
        void this.loadHistory(true);
    }

    public disconnectedCallback(): void {
        super.disconnectedCallback();
        clearInterval(this.timer);
    }

    protected shouldUpdate(changed: PropertyValues): boolean {
        const previous = changed.get("hass") as HomeAssistant | undefined;
        if (!this.config || !this.hass || changed.size > 1 || !changed.has("hass") || !previous) {
            return true;
        }
        if (
            previous.entities !== this.hass.entities ||
            previous.devices !== this.hass.devices ||
            previous.locale !== this.hass.locale ||
            previous.language !== this.hass.language ||
            previous.formatEntityState !== this.hass.formatEntityState
        ) {
            return true;
        }
        // Home Assistant hands the card every state change in the house; only the receiver's sensors and the feeders matter.
        return this.watched().some((id) => previous.states[id] !== this.hass?.states[id]);
    }

    protected updated(): void {
        // The first hass, or a receiver picked in the editor, has a curve to read.
        void this.loadHistory(false);
    }

    private watched(): string[] {
        if (!this.hass || !this.config) {
            return [];
        }
        const feeders = (this.config.feeders ?? []).flatMap((feeder) => [feeder.entity, feeder.detail ?? ""]);
        return [...Object.values(receiverSensors(this.hass, this.config.device)), ...feeders].filter((id) => !!id);
    }

    /** Reads the curve again when `again`, otherwise only when its sensor has changed since the last read. */
    private async loadHistory(again: boolean): Promise<void> {
        const hass = this.hass;
        const id = hass && this.config ? receiverSensors(hass, this.config.device).aircraft_tracked : undefined;
        if (!hass || !id || (!again && this.historyOf === id)) {
            return;
        }
        if (this.historyOf !== id) {
            // Another receiver's curve is no curve of this one, even while its own is on the way.
            this.history = [];
            this.historyLoaded = false;
            this.historyOf = id;
        }
        const now = Date.now();
        try {
            const rows = await fetchStatistics(hass, id, now - HISTORY_HOURS * HOUR, now);
            if (this.historyOf === id) {
                this.history = rows;
                this.historyLoaded = true;
            }
        } catch (error) {
            // The card still shows the present values; only the curve is left without its past.
            console.warn("adsb-receiver-card: could not read the history of", id, error);
        }
    }

    protected render(): TemplateResult | typeof nothing {
        if (!this.hass || !this.config) {
            return nothing;
        }
        const sensors = receiverSensors(this.hass, this.config.device);
        if (!this.hass.devices?.[this.config.device] || !Object.keys(sensors).length) {
            return html`<ha-card class="message">${this.text("common.no_receiver")}</ha-card>`;
        }
        const status = receiverStatus(this.hass, sensors);
        return this.compact() ? this.compactCard(sensors, status) : this.fullCard(sensors, status);
    }

    private fullCard(sensors: Partial<Record<SensorKey, string>>, status: Status): TemplateResult {
        const device = this.hass?.devices?.[this.config?.device ?? ""];
        const version = device?.sw_version ? [device.manufacturer, device.sw_version].filter(Boolean).join(" ") : "";
        const available = status !== "unavailable";
        return html`
            <ha-card class="full ${status}">
                <div class="top">
                    ${this.icon()}
                    <div class="who">
                        <div class="name">${receiverName(this.hass!, this.config!)}</div>
                        <div class="status">${this.text(`status.${status}`)}</div>
                        ${available ? html`<div class="rates">${this.pieces(this.rates(sensors))}</div>` : nothing}
                    </div>
                    ${version ? html`<div class="version">${version}</div>` : nothing}
                </div>
                ${
                    available
                        ? html`
                              <div class="figures">
                                  ${this.figure(sensors.aircraft_tracked, "figures.tracked")}
                                  ${this.figure(sensors.aircraft_with_position, "figures.with_position")}
                                  ${this.figure(sensors.max_range, "figures.range", true, { minutes: formatNumber(RANGE_MINUTES, this.numberFormat(), 0) })}
                              </div>
                              ${this.curve(sensors)} ${this.meter(sensors)}
                          `
                        : nothing
                }
                ${this.config?.feeders?.length ? html`<div class="feeders">${this.config.feeders.map((feeder) => this.feeder(feeder))}</div>` : nothing}
            </ha-card>
        `;
    }

    private compactCard(sensors: Partial<Record<SensorKey, string>>, status: Status): TemplateResult {
        const available = status !== "unavailable";
        const line = [
            `${this.number(sensors.aircraft_tracked)} ${this.text("figures.tracked")}`,
            `${this.number(sensors.aircraft_with_position)} ${this.text("figures.with_position")}`,
            this.rates(sensors)[0],
        ];
        return html`
            <ha-card class="compact ${status}">
                <button class="row" @click=${() => this.moreInfo(sensors.aircraft_tracked ?? sensors.positions_per_minute)}>
                    ${this.icon()}
                    <div class="who">
                        <div class="name">
                            ${receiverName(this.hass!, this.config!)} <span class="status">${this.text(`status.${status}`)}</span>
                        </div>
                        ${available ? html`<div class="line">${this.pieces(line)}</div>` : nothing}
                    </div>
                    ${available ? this.smallCurve(sensors) : nothing}
                </button>
            </ha-card>
        `;
    }

    /** Parts of a sentence, each kept whole, so a number never wraps away from its unit. */
    private pieces(parts: string[]): TemplateResult[] {
        return parts.map((part, index) => html`${index ? ", " : ""}<span class="piece">${part}</span>`);
    }

    private icon(): TemplateResult {
        return html`<div class="icon"><ha-icon icon="mdi:radar"></ha-icon></div>`;
    }

    /** Messages per second and positions per minute, as a sentence's parts. */
    private rates(sensors: Partial<Record<SensorKey, string>>): string[] {
        const positions = valueOf(this.hass!, sensors.positions_per_minute);
        return [
            this.text("rates.messages", { value: this.number(sensors.messages_per_second) }),
            this.text(positions === 1 ? "rates.positions_one" : "rates.positions", { value: this.number(sensors.positions_per_minute) }),
        ];
    }

    private figure(entityId: string | undefined, label: string, withUnit = false, values: Record<string, string> = {}): TemplateResult {
        const unit = withUnit && entityId ? this.hass?.states[entityId]?.attributes.unit_of_measurement : undefined;
        return html`
            <button class="figure" @click=${() => this.moreInfo(entityId)}>
                <span class="value">${this.number(entityId)}${unit ? html` <span class="unit">${unit}</span>` : nothing}</span>
                <span class="label">${this.text(label, values)}</span>
            </button>
        `;
    }

    private curve(sensors: Partial<Record<SensorKey, string>>): TemplateResult | typeof nothing {
        if (!sensors.aircraft_tracked) {
            return nothing;
        }
        const { path, peak, lone } = this.curvePath(sensors.aircraft_tracked, CURVE);
        return html`
            <button class="curve" @click=${() => this.moreInfo(sensors.aircraft_tracked)}>
                <svg viewBox="0 0 ${CURVE.width} ${CURVE.height}" preserveAspectRatio="none" aria-hidden="true">
                    <line class="base" x1="0" x2=${CURVE.width} y1=${CURVE.height - 1} y2=${CURVE.height - 1}></line>
                    <path class=${lone ? "lone" : ""} d=${path}></path>
                </svg>
                <span class="caption">
                    <span>${this.text("curve.past", { hours: formatNumber(HISTORY_HOURS, this.numberFormat(), 0) })}</span>
                    <span>${peak > 0 ? this.text("curve.peak", { value: formatNumber(peak, this.numberFormat(), 0) }) : ""}</span>
                    <span>${this.text("curve.now")}</span>
                </span>
            </button>
        `;
    }

    private smallCurve(sensors: Partial<Record<SensorKey, string>>): TemplateResult | typeof nothing {
        if (!sensors.aircraft_tracked) {
            return nothing;
        }
        const { path, lone } = this.curvePath(sensors.aircraft_tracked, SMALL_CURVE);
        return html`
            <svg class="small-curve" viewBox="0 0 ${SMALL_CURVE.width} ${SMALL_CURVE.height}" aria-hidden="true">
                <path class=${lone ? "lone" : ""} d=${path}></path>
            </svg>
        `;
    }

    private curvePath(entityId: string, box: { width: number; height: number }): { path: string; peak: number; lone: boolean } {
        const now = Date.now();
        const start = now - HISTORY_HOURS * HOUR;
        const current = valueOf(this.hass!, entityId);
        // Until the recorder answers, the present value alone would look like a receiver without an hour of statistics.
        if (!this.historyLoaded) {
            return { path: "", peak: 0, lone: false };
        }
        const points = curvePoints(this.history, start, now, current);
        const peak = peakOf(this.history, start, current);
        // A sky of one aircraft at most shouldn't look as full as a busy one, so the top is never below 4.
        return { path: linePath(points, start, now, box.width, box.height, Math.max(peak, 4)), peak, lone: points.length === 1 };
    }

    private meter(sensors: Partial<Record<SensorKey, string>>): TemplateResult | typeof nothing {
        const signal = valueOf(this.hass!, sensors.signal);
        const noise = valueOf(this.hass!, sensors.noise);
        const places = meter(signal, noise);
        if (!places) {
            return nothing;
        }
        const gap =
            places.signal === null ? null : { left: Math.min(places.noise, places.signal), width: Math.abs(places.signal - places.noise) };
        return html`
            <div class="meter">
                <div class="levels">
                    <button @click=${() => this.moreInfo(sensors.noise)}>
                        ${this.text("meter.noise")} ${this.withUnit(sensors.noise)}
                    </button>
                    <button @click=${() => this.moreInfo(sensors.signal)}>
                        ${signal === null ? this.text("meter.signal_unknown") : `${this.text("meter.signal")} ${this.withUnit(sensors.signal)}`}
                    </button>
                </div>
                <div class="bar">
                    ${gap ? html`<div class="gap" style="left:${gap.left}%;width:${gap.width}%"></div>` : nothing}
                    <div class="mark noise" style="left:${places.noise}%"></div>
                    ${places.signal === null ? nothing : html`<div class="mark signal" style="left:${places.signal}%"></div>`}
                </div>
            </div>
        `;
    }

    private feeder(feeder: FeederConfig): TemplateResult {
        const entity = this.hass?.states[feeder.entity];
        const detail = feeder.detail ? this.hass?.states[feeder.detail] : undefined;
        const name = feeder.name || (entity?.attributes.friendly_name as string | undefined) || feeder.entity;
        const missing = (id: string) => this.text("common.no_entity", { entity: id });
        const parts = [entity ? this.formatState(entity) : missing(feeder.entity)];
        if (feeder.detail) {
            parts.push(detail ? this.formatState(detail) : missing(feeder.detail));
        }
        const value = parts.join(", ");
        return html`
            <button class="feeder" @click=${() => this.moreInfo(feeder.entity)}>
                <span class="dot ${feederState(entity)}"></span>
                <span class="feeder-name">${name}</span>
                <span class="feeder-value">${value}</span>
            </button>
        `;
    }

    private formatState(entity: NonNullable<HomeAssistant["states"][string]>): string {
        return this.hass?.formatEntityState ? this.hass.formatEntityState(entity) : entity.state;
    }

    /** The sensor's number in the viewer's format, or a dash when it has none. */
    private number(entityId: string | undefined): string {
        const value = valueOf(this.hass!, entityId);
        return value === null
            ? "–"
            : formatNumber(value, this.numberFormat(), entityId ? this.hass?.entities?.[entityId]?.display_precision : undefined);
    }

    private withUnit(entityId: string | undefined): string {
        const unit = entityId ? this.hass?.states[entityId]?.attributes.unit_of_measurement : undefined;
        return unit ? `${this.number(entityId)} ${unit}` : this.number(entityId);
    }

    private compact(): boolean {
        return this.config?.layout === "compact";
    }

    private moreInfo(entityId: string | undefined): void {
        if (entityId) {
            this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
        }
    }

    /** A text in the viewer's language, with `{name}` in it replaced, so a translation can put the value where it reads right. */
    private text(key: string, values: Record<string, string> = {}): string {
        return translate(this.language(), key).replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
    }

    private numberFormat(): NumberFormat {
        return { language: this.language(), number_format: this.hass?.locale?.number_format };
    }

    private language(): string {
        return this.hass?.locale?.language ?? this.hass?.language ?? browserLanguage();
    }

    static get styles(): CSSResultGroup {
        return css`
            ha-card {
                container-type: inline-size;
                font-variant-numeric: tabular-nums;
                --receiver-color: var(--secondary-text-color);
                --receiver-tint: rgba(var(--rgb-primary-text-color, 33, 33, 33), 0.06);
            }

            ha-card.receiving {
                --receiver-color: var(--success-color, #43a047);
                --receiver-tint: rgba(var(--rgb-success-color, 67, 160, 71), 0.15);
            }

            ha-card.unavailable {
                --receiver-color: var(--error-color, #db4437);
                --receiver-tint: rgba(var(--rgb-error-color, 219, 68, 55), 0.15);
            }

            ha-card.message {
                padding: 16px;
                color: var(--secondary-text-color);
            }

            button {
                padding: 0;
                border: none;
                background: none;
                color: inherit;
                font: inherit;
                text-align: inherit;
                cursor: pointer;
            }

            .full {
                padding: 14px 16px 12px;
            }

            .top {
                display: flex;
                align-items: center;
                gap: 12px;
            }

            .icon {
                flex: none;
                width: 40px;
                height: 40px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                color: var(--receiver-color);
                background: var(--receiver-tint);
            }

            .who {
                flex: 1;
                min-width: 0;
            }

            .name {
                font-size: 16px;
                font-weight: var(--ha-font-weight-medium, 500);
                overflow-wrap: anywhere;
            }

            .status {
                font-size: 13px;
                color: var(--receiver-color);
            }

            .rates,
            .version,
            .label,
            .caption,
            .levels,
            .feeder-value,
            .line,
            .unit {
                color: var(--secondary-text-color);
            }

            .rates {
                font-size: 12px;
            }

            .version {
                align-self: flex-start;
                font-size: 12px;
                white-space: nowrap;
            }

            .piece,
            .levels button {
                white-space: nowrap;
            }

            /* On a narrow card the version goes under the rates, leaving the name and rates the width, and the figures shrink so a number keeps its unit. */
            @container (max-width: 299px) {
                .top {
                    flex-wrap: wrap;
                    row-gap: 2px;
                }

                .version {
                    order: 3;
                    flex-basis: 100%;
                    padding-left: 52px;
                }

                .value {
                    font-size: 20px;
                }

                .unit {
                    font-size: 12px;
                }
            }

            .figures {
                display: grid;
                grid-template-columns: repeat(3, minmax(0, 1fr));
                margin: 14px 0 4px;
                text-align: center;
            }

            .figure {
                display: flex;
                flex-direction: column;
                align-items: center;
                padding: 0 4px;
                text-align: center;
            }

            .figure + .figure {
                border-left: 1px solid var(--divider-color);
            }

            .value {
                white-space: nowrap;
                font-size: 24px;
                font-weight: var(--ha-font-weight-medium, 500);
                line-height: 1.2;
            }

            .unit {
                font-size: 13px;
                font-weight: var(--ha-font-weight-normal, 400);
            }

            .label {
                font-size: 12px;
            }

            .curve {
                display: block;
                width: 100%;
                margin-top: 10px;
            }

            /* The present value sits on the right edge, and its dot would be cut in half there. */
            .curve svg,
            .small-curve {
                overflow: visible;
            }

            .curve svg {
                display: block;
                width: 100%;
                height: 44px;
            }

            svg path {
                fill: none;
                stroke: var(--primary-color);
                stroke-width: 2;
                stroke-linejoin: round;
                stroke-linecap: round;
                vector-effect: non-scaling-stroke;
            }

            /* Only the present value, before the recorder has an hour: a dot that shows. */
            svg path.lone {
                stroke-width: 6;
            }

            svg .base {
                stroke: var(--divider-color);
                stroke-width: 1;
                vector-effect: non-scaling-stroke;
            }

            .caption {
                display: flex;
                justify-content: space-between;
                gap: 8px;
                font-size: 11px;
            }

            .meter {
                margin-top: 12px;
            }

            .levels {
                display: flex;
                flex-wrap: wrap;
                justify-content: space-between;
                gap: 0 12px;
                margin-bottom: 4px;
                font-size: 12px;
            }

            .bar {
                position: relative;
                height: 8px;
                border-radius: 4px;
                background: rgba(var(--rgb-primary-text-color, 33, 33, 33), 0.08);
            }

            .gap {
                position: absolute;
                top: 0;
                height: 8px;
                border-radius: 4px;
                background: var(--primary-color);
                opacity: 0.3;
            }

            .mark {
                position: absolute;
                top: -3px;
                width: 3px;
                height: 14px;
                margin-left: -1.5px;
                border-radius: 2px;
            }

            .mark.noise {
                background: var(--disabled-text-color, #9e9e9e);
            }

            .mark.signal {
                background: var(--primary-color);
            }

            .feeders {
                margin-top: 12px;
                padding-top: 6px;
                border-top: 1px solid var(--divider-color);
            }

            .feeder {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 2px 10px;
                width: 100%;
                padding: 7px 0;
                font-size: 13px;
            }

            .dot {
                flex: none;
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: var(--disabled-text-color, #9e9e9e);
            }

            .dot.ok {
                background: var(--success-color, #43a047);
            }

            .dot.error {
                background: var(--error-color, #db4437);
            }

            .feeder-name {
                flex: 1 1 auto;
                min-width: 0;
                overflow-wrap: anywhere;
            }

            .feeder-value {
                margin-left: auto;
                text-align: right;
                overflow-wrap: anywhere;
            }

            .compact .row {
                display: flex;
                align-items: center;
                gap: 12px;
                width: 100%;
                padding: 12px 14px;
            }

            .compact .icon {
                width: 36px;
                height: 36px;
            }

            .compact .name {
                font-size: 14px;
            }

            .compact .status {
                font-weight: var(--ha-font-weight-normal, 400);
            }

            .line {
                font-size: 12px;
                overflow-wrap: anywhere;
            }

            .small-curve {
                flex: none;
                width: 90px;
                height: 32px;
            }

            /* Below this the curve would leave the texts too little room, and they matter more. */
            @container (max-width: 279px) {
                .small-curve {
                    display: none;
                }
            }
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        "adsb-receiver-card": AdsbReceiverCard;
    }
}
