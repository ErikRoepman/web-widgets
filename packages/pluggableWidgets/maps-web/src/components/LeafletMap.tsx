import { ReactElement, useEffect, useRef, useState, useCallback } from "react";
import { MapContainer, Marker as MarkerComponent, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import classNames from "classnames";
import { getDimensions } from "@mendix/widget-plugin-platform/utils/get-dimensions";
import { SharedProps, CustomProps } from "../../typings/shared";
import { MapProviderEnum } from "../../typings/MapsProps";
import { translateZoom } from "../utils/zoom";
import { DivIcon, latLngBounds, Icon as LeafletIcon, LatLngBounds } from "leaflet";
import { baseMapLayer } from "../utils/leaflet";
import { ValueStatus } from "mendix";
import Big from "big.js";

export interface LeafletProps extends SharedProps, CustomProps {
    mapProvider: MapProviderEnum;
    attributionControl: boolean;
    /**
     * Optional debounce duration for bounds updates (ms).
     * If not provided, defaults to 300ms.
     */
    boundsDebounceMs?: number;
}

/**
 * There is an ongoing issue in `react-leaflet` that fails to properly set the icon urls in the
 * default marker implementation. Issue https://github.com/PaulLeCam/react-leaflet/issues/453
 * describes the problem and also proposes a few solutions. But all of them require a hackish method
 * to override `leaflet`'s implementation of the default Icon. Instead, we always set the
 * `Marker.icon` prop instead of relying on the default. So if a custom icon is set, we use that.
 * If not, we reuse a leaflet icon that's the same as the default implementation should be.
 */
const defaultMarkerIcon = new LeafletIcon({
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    iconRetinaUrl: require("leaflet/dist/images/marker-icon.png"),
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    iconUrl: require("leaflet/dist/images/marker-icon.png"),
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    shadowUrl: require("leaflet/dist/images/marker-shadow.png"),
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});

function SetBoundsComponent(props: Pick<LeafletProps, "autoZoom" | "currentLocation" | "locations">): null {
    const map = useMap();
    const { autoZoom, currentLocation, locations } = props;

    // Track whether the user is interacting with the map
    const isUserInteractingRef = useRef(false);
    const interactionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Consider only fitting once on mount if you want "initial fit" behavior:
    const hasFittedOnceRef = useRef(false);

    // Wire user interaction state
    useEffect(() => {
        const start = () => {
            isUserInteractingRef.current = true;
            if (interactionTimeoutRef.current) {
                clearTimeout(interactionTimeoutRef.current);
            }
        };

        const end = () => {
            // Give a small grace period after interaction ends
            if (interactionTimeoutRef.current) {
                clearTimeout(interactionTimeoutRef.current);
            }
            interactionTimeoutRef.current = setTimeout(() => {
                isUserInteractingRef.current = false;
            }, 300); // grace ms
        };

        map.on("movestart", start);
        map.on("dragstart", start);
        map.on("zoomstart", start);

        map.on("moveend", end);
        map.on("dragend", end);
        map.on("zoomend", end);

        return () => {
            map.off("movestart", start);
            map.off("dragstart", start);
            map.off("zoomstart", start);
            map.off("moveend", end);
            map.off("dragend", end);
            map.off("zoomend", end);
            if (interactionTimeoutRef.current) {
                clearTimeout(interactionTimeoutRef.current);
            }
        };
    }, [map]);

    // Recenter ONLY when the inputs (locations/currentLocation/autoZoom) change
    useEffect(() => {
        const bounds = latLngBounds(
            locations
                .concat(currentLocation ? [currentLocation] : [])
                .filter(m => !!m)
                .map(m => [m.latitude, m.longitude])
        );

        if (!bounds.isValid()) return;

        // If you want "fit once on mount" when autoZoom is true:
        if (autoZoom && !hasFittedOnceRef.current) {
            hasFittedOnceRef.current = true;
            map.flyToBounds(bounds, { padding: [0.5, 0.5], animate: false });
            // Invalidate after the flyToBounds to ensure proper rendering
            setTimeout(() => map.invalidateSize(), 0);
            return;
        }

        // If the user is interacting, don’t recenter now
        if (isUserInteractingRef.current) return;

        // Otherwise, keep the map roughly aligned when data changes
        if (autoZoom) {
            map.flyToBounds(bounds, { padding: [0.5, 0.5], animate: false });
            setTimeout(() => map.invalidateSize(), 0);
        } else {
            // Only pan if the new center is significantly different
            const target = bounds.getCenter();
            const curCenter = map.getCenter();
            const distance = curCenter.distanceTo(target); // meters
            if (distance > 5) {
                map.panTo(target, { animate: false });
            }
        }
    }, [map, autoZoom, currentLocation, locations]);

    return null;
}
/**
 * Debounced bounds event.
 * - Schedules a callback on move/zoom/drag.
 * - Only emits after the user stops interacting for `delayMs`.
 * - Emits once on mount if bounds exist.
 */
function DebouncedBoundsEvent(props: { delayMs: number; onDebouncedBounds: (bounds: LatLngBounds) => void }): null {
    const { delayMs, onDebouncedBounds } = props;
    const map = useMapEvents({
        move: () => schedule(),
        zoom: () => schedule(),
        drag: () => schedule()
        // You could also add moveend/zoomend/dragend to schedule as well, but move/zoom/drag is sufficient.
    });

    // We keep a timeout id in a ref so it persists across renders.
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const emit = useCallback(() => {
        const b = map.getBounds?.();
        if (b) onDebouncedBounds(b);
    }, [map, onDebouncedBounds]);

    const schedule = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
        }
        timerRef.current = setTimeout(emit, delayMs);
    }, [emit, delayMs]);

    // Fire once on mount with current bounds (if available), debounced to coalesce with initial movement.
    useEffect(() => {
        const initial = map.getBounds?.();
        if (initial) {
            // Schedule instead of immediate so that SetBoundsComponent’s initial pan/fly can complete.
            schedule();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current);
            }
        };
    }, []);

    return null;
}

export function LeafletMap(props: LeafletProps): ReactElement {
    const center = { lat: 51.906688, lng: 4.48837 };
    const {
        autoZoom,
        attributionControl,
        className,
        currentLocation,
        locations,
        mapProvider,
        mapsToken,
        optionScroll: scrollWheelZoom,
        optionZoomControl: zoomControl,
        style,
        zoomLevel: zoom,
        optionDrag: dragging,
        onBoundaryChange,
        southWestLat,
        southWestLong,
        northEastLat,
        northEastLong,
        boundsDebounceMs
    } = props;

    // Keep Leaflet bounds in React state (internal, safe)
    const [pendingBounds, setPendingBounds] = useState<LatLngBounds | null>(null);

    // Remember last values to avoid redundant Mendix updates
    const lastBoundsRef = useRef<{ swLat: number; swLng: number; neLat: number; neLng: number } | null>(null);

    // Update Mendix AFTER render when bounds change
    useEffect(() => {
        if (!pendingBounds) return;

        const sw = pendingBounds.getSouthWest();
        const ne = pendingBounds.getNorthEast();

        const nextValues = { swLat: sw.lat, swLng: sw.lng, neLat: ne.lat, neLng: ne.lng };
        const prev = lastBoundsRef.current;

        const approxEqual = (a: number, b: number, eps = 1e-10) => Math.abs(a - b) < eps;

        const changed =
            !prev ||
            !(
                approxEqual(prev.swLat, nextValues.swLat) &&
                approxEqual(prev.swLng, nextValues.swLng) &&
                approxEqual(prev.neLat, nextValues.neLat) &&
                approxEqual(prev.neLng, nextValues.neLng)
            );

        if (changed) {
            if (southWestLat?.status === ValueStatus.Available) {
                southWestLat.setValue(Big(nextValues.swLat.toPrecision(8)));
            }
            if (southWestLong?.status === ValueStatus.Available) {
                southWestLong.setValue(Big(nextValues.swLng.toPrecision(8)));
            }
            if (northEastLat?.status === ValueStatus.Available) {
                northEastLat.setValue(Big(nextValues.neLat.toPrecision(8)));
            }
            if (northEastLong?.status === ValueStatus.Available) {
                northEastLong.setValue(Big(nextValues.neLng.toPrecision(8)));
            }

            if (onBoundaryChange?.canExecute) {
                onBoundaryChange.execute();
            }

            lastBoundsRef.current = nextValues;
        }
    }, [pendingBounds, southWestLat, southWestLong, northEastLat, northEastLong, onBoundaryChange]);

    const effectiveDebounce = typeof boundsDebounceMs === "number" ? boundsDebounceMs : 300;

    return (
        <div className={classNames("widget-maps", className)} style={{ ...style, ...getDimensions(props) }}>
            <div className="widget-leaflet-maps-wrapper">
                <MapContainer
                    attributionControl={attributionControl}
                    center={center}
                    className="widget-leaflet-maps"
                    dragging={dragging}
                    maxZoom={18}
                    minZoom={1}
                    scrollWheelZoom={scrollWheelZoom}
                    zoom={autoZoom ? translateZoom("city") : zoom}
                    zoomControl={zoomControl}
                    style={{ top: 0, bottom: 0, left: 0, right: 0, position: "absolute", zIndex: 1 }}
                >
                    <TileLayer {...baseMapLayer(mapProvider, mapsToken)} />
                    {locations
                        .concat(currentLocation ? [currentLocation] : [])
                        .filter(m => !!m)
                        .map(marker => (
                            <MarkerComponent
                                icon={
                                    marker.url
                                        ? new DivIcon({
                                              html: `<img src="${marker.url}" class="custom-leaflet-map-icon-marker-icon" alt="map marker" />`,
                                              className: "custom-leaflet-map-icon-marker"
                                          })
                                        : defaultMarkerIcon
                                }
                                interactive={!!marker.title || !!marker.onClick}
                                key={`marker_${marker.id ?? marker.latitude + "_" + marker.longitude}`}
                                eventHandlers={!marker.title && marker.onClick ? { click: marker.onClick } : undefined}
                                position={{ lat: marker.latitude, lng: marker.longitude }}
                                title={marker.title}
                            >
                                {marker.title && (
                                    <Popup>
                                        <span
                                            style={{ cursor: marker.onClick ? "pointer" : "none" }}
                                            onClick={marker.onClick}
                                        >
                                            {marker.title}
                                        </span>
                                    </Popup>
                                )}
                            </MarkerComponent>
                        ))}
                    <SetBoundsComponent autoZoom={autoZoom} currentLocation={currentLocation} locations={locations} />
                    {/* Debounced bounds collector */}
                    <DebouncedBoundsEvent delayMs={effectiveDebounce} onDebouncedBounds={b => setPendingBounds(b)} />
                </MapContainer>
            </div>
        </div>
    );
}
