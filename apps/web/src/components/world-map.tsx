import { geoEqualEarth, geoPath } from "d3-geo"
import type { Feature, FeatureCollection, Geometry } from "geojson"
import countries from "i18n-iso-countries"
import { useMemo, useState } from "react"
import { feature } from "topojson-client"
import type { GeometryCollection, Topology } from "topojson-specification"
import atlas from "world-atlas/countries-110m.json"

import { ramp } from "@/components/heatmap"
import { TipBox } from "@/components/traffic-chart"
import type { BreakdownRow } from "@/lib/api"
import { formatCountry, formatNumber, formatPercent } from "@/lib/format"

const W = 800
const H = 400

type Shape = { id: string; alpha2: string; d: string; name: string }

// Computed once: the projected outline of every country.
let shapes: Shape[] | null = null
function getShapes(): Shape[] {
  if (shapes) return shapes
  const topo = atlas as unknown as Topology<{
    countries: GeometryCollection<{ name: string }>
  }>
  const fc = feature(topo, topo.objects.countries) as FeatureCollection<
    Geometry,
    { name: string }
  >
  // Antarctica takes a lot of room and has no visitors.
  const land = fc.features.filter((f) => f.id !== "010")
  const projection = geoEqualEarth().fitExtent(
    [
      [4, 4],
      [W - 4, H - 4],
    ],
    { type: "FeatureCollection", features: land }
  )
  const path = geoPath(projection)
  // A few territories (e.g. Kosovo, N. Cyprus) have no numeric code.
  shapes = land.map((f: Feature<Geometry, { name: string }>, i) => ({
    id: f.id === undefined ? `x${i}` : String(f.id),
    alpha2: countries.numericToAlpha2(String(f.id)) ?? "",
    d: path(f) ?? "",
    name: f.properties.name,
  }))
  return shapes
}

/** A choropleth of visitors per country, one hue. */
export function WorldMap({
  rows,
  total,
  onSelect,
}: {
  rows: BreakdownRow[]
  total?: number
  onSelect?: (code: string) => void
}) {
  const all = useMemo(() => getShapes(), [])
  const [hover, setHover] = useState<{
    shape: Shape
    x: number
    y: number
  } | null>(null)
  const byCode = useMemo(
    () => new Map(rows.map((r) => [r.value, r.visitors])),
    [rows]
  )
  const max = Math.max(1, ...rows.map((r) => r.visitors))
  const hovered = hover ? (byCode.get(hover.shape.alpha2) ?? 0) : 0

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        // An "img" hides its children from assistive technology, so a map with clickable
        // countries is a group of buttons instead.
        role={onSelect ? "group" : "img"}
        aria-label="Visitors by country"
        onMouseLeave={() => setHover(null)}
      >
        {all.map((s) => {
          const v = byCode.get(s.alpha2) ?? 0
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: an SVG path is the only clickable shape a map has; it gets a role, a label and a key handler
            <path
              key={s.id}
              d={s.d}
              fill={v ? ramp(Math.sqrt(v / max)) : "var(--surface-2)"}
              stroke="var(--surface)"
              strokeWidth={0.5}
              className={
                v && onSelect
                  ? "cursor-pointer transition-opacity hover:opacity-80 focus:opacity-80 focus:outline-none"
                  : undefined
              }
              tabIndex={v && onSelect ? 0 : undefined}
              role={v && onSelect ? "button" : undefined}
              aria-label={v && onSelect ? `${s.name}: ${v}` : undefined}
              onKeyDown={
                v && onSelect
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        onSelect(s.alpha2)
                      }
                    }
                  : undefined
              }
              onMouseMove={(e) => {
                const box =
                  e.currentTarget.ownerSVGElement!.getBoundingClientRect()
                setHover({
                  shape: s,
                  x: e.clientX - box.left,
                  y: e.clientY - box.top,
                })
              }}
              onClick={v && onSelect ? () => onSelect(s.alpha2) : undefined}
            />
          )
        })}
      </svg>
      {hover && (
        <div
          className="pointer-events-none absolute z-10"
          style={{
            left: hover.x,
            top: hover.y,
            transform: `translate(${hover.x > 300 ? "-110%" : "10%"}, -110%)`,
          }}
        >
          <TipBox>
            <p className="font-medium text-fg">
              {hover.shape.alpha2
                ? formatCountry(hover.shape.alpha2)
                : hover.shape.name}
            </p>
            <p className="tnum text-fg-secondary">
              {formatNumber(hovered)} visitors
              {total && hovered ? ` · ${formatPercent(hovered / total)}` : ""}
            </p>
          </TipBox>
        </div>
      )}
    </div>
  )
}
