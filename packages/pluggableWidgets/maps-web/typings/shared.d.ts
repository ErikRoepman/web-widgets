import { Dimensions } from "@mendix/widget-plugin-platform/utils/get-dimensions";
import { CSSProperties } from "react";
import { ActionValue, DynamicValue, EditableValue, ListValue, ListActionValue, ListAttributeValue, WebImage } from "mendix";

export interface ModeledMarker {
    address?: string;
    latitude?: number;
    longitude?: number;
    title?: string;
    customMarker?: string;
    action?: () => void;
    id?: string;
}

export interface Marker {
    latitude: number;
    longitude: number;
    url: string;
    onClick?: () => void;
    title?: string;
    id?: string;
}

export interface SharedProps extends Dimensions {
    autoZoom: boolean;
    optionZoomControl: boolean;
    zoomLevel: number;
    optionDrag: boolean;
    optionScroll: boolean;
    showCurrentLocation: boolean;
    currentLocation?: Marker;
    locations: Marker[];
    mapsToken?: string;
    className?: string;
    style?: CSSProperties;
}
/**
 * Contains the additional props that have been added to the MapviewerProps by Mendix
 * Any changes to attributes in the XML must be reflected here
 */
export interface CustomProps{
    onBoundaryChange?: ActionValue;
    southWestLat?: EditableValue<Big>;
    southWestLong?: EditableValue<Big>;
    northEastLat?: EditableValue<Big>;
    northEastLong?: EditableValue<Big>;
}
