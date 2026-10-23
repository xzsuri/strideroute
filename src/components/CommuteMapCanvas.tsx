import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import {
  ExternalLink,
  Check,
  Plus,
  X,
} from 'lucide-react';
import {
  ComputedRouteOption,
  DailyRoutineRule,
  GeoLocation,
  LivePlace,
  RouteOptimizationMode,
  TravelModeOption,
} from '../types/commute';
import {
  computeOpenDrivingRoutes,
  discoverNearbyOpenPlaces,
  getDistanceMeters,
} from '../utils/openMapServices';

interface CommuteMapCanvasProps {
  userLocation: GeoLocation;
  simulatedPosition: GeoLocation | null;
  activeRoutine: DailyRoutineRule;
  travelMode: TravelModeOption;
  optimizationMode: RouteOptimizationMode;
  showTrafficLayer: boolean;
  selectedRouteIndex: number;
  onSelectRouteIndex: (idx: number) => void;
  onRoutesComputed: (
    routes: ComputedRouteOption[],
    isLoading: boolean,
    error: string | null
  ) => void;
  nearbySuggestions: LivePlace[];
  onNearbySuggestionsLoaded: (places: LivePlace[], isLoading: boolean) => void;
  onAutoSeedRoutinePlaces: (
    pitstop: LivePlace | null,
    destination: LivePlace | null
  ) => void;
  onSwapPitstop: (place: LivePlace) => void;
  onSetDestination: (place: LivePlace) => void;
  searchCategoryFilter: string;
  isDarkMode?: boolean;
  isCompactPip?: boolean;
  isMapVisible?: boolean;
}

const DARK_TILES =
  'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const LIGHT_TILES =
  'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';

export const CommuteMapCanvas: React.FC<CommuteMapCanvasProps> = (props) => {
  const {
    userLocation,
    simulatedPosition,
    activeRoutine,
    optimizationMode,
    selectedRouteIndex,
    onSelectRouteIndex,
    onRoutesComputed,
    nearbySuggestions,
    onNearbySuggestionsLoaded,
    onAutoSeedRoutinePlaces,
    onSwapPitstop,
    onSetDestination,
    searchCategoryFilter,
    isDarkMode = true,
    isCompactPip = false,
    isMapVisible = true,
  } = props;

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const routeLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const markersLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);

  const [computedRoutes, setComputedRoutes] = useState<ComputedRouteOption[]>([]);
  const [activeInfoPlace, setActiveInfoPlace] = useState<{
    place: LivePlace;
    role: 'PITSTOP' | 'DESTINATION' | 'SUGGESTION';
  } | null>(null);

  const seededSlotsRef = useRef<Set<string>>(new Set());
  const lastFittedKeyRef = useRef<string | null>(null);

  // Stabilize route origin with a 250m deadband so mobile GPS sensor noise never triggers route recalculation or zoom twitching
  const [stableOrigin, setStableOrigin] = useState<GeoLocation>(userLocation);
  useEffect(() => {
    setStableOrigin((prev) => {
      if (getDistanceMeters(prev, userLocation) >= 250) {
        return userLocation;
      }
      return prev;
    });
  }, [userLocation.lat, userLocation.lng]);

  // 1. Initialize Leaflet Map Instance once
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [userLocation.lat, userLocation.lng],
      zoom: 14,
      zoomControl: !isCompactPip,
      attributionControl: false,
    });

    const tileLayer = L.tileLayer(isDarkMode ? DARK_TILES : LIGHT_TILES, {
      maxZoom: 19,
      subdomains: 'abcd',
    }).addTo(map);

    const routeGroup = L.layerGroup().addTo(map);
    const markersGroup = L.layerGroup().addTo(map);

    mapRef.current = map;
    tileLayerRef.current = tileLayer;
    routeLayerGroupRef.current = routeGroup;
    markersLayerGroupRef.current = markersGroup;

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
    });
    resizeObserver.observe(mapContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      routeLayerGroupRef.current = null;
      markersLayerGroupRef.current = null;
      userMarkerRef.current = null;
    };
  }, []);

  // 2. Switch Dark / Light Map Tiles seamlessly
  useEffect(() => {
    if (!tileLayerRef.current) return;
    tileLayerRef.current.setUrl(isDarkMode ? DARK_TILES : LIGHT_TILES);
  }, [isDarkMode]);

  // 3. Discover Nearby OpenStreetMap Places & Auto-Seed Routine
  useEffect(() => {
    let cancelled = false;
    onNearbySuggestionsLoaded([], true);

    async function loadPlaces() {
      const { places, suggestedDestination } = await discoverNearbyOpenPlaces(
        stableOrigin,
        searchCategoryFilter || activeRoutine.pitstopCategory,
        activeRoutine.timeSlot
      );
      if (cancelled) return;

      onNearbySuggestionsLoaded(places, false);

      const isPitstopFar =
        activeRoutine.preferredPitstop &&
        getDistanceMeters(stableOrigin, activeRoutine.preferredPitstop.location) > 80000;
      const isDestinationFar =
        activeRoutine.destination &&
        getDistanceMeters(stableOrigin, activeRoutine.destination.location) > 80000;

      const needsPitstop = !activeRoutine.preferredPitstop || isPitstopFar;
      const needsDestination = !activeRoutine.destination || isDestinationFar;

      const slotKey = `${activeRoutine.id}_${stableOrigin.lat.toFixed(2)}_${stableOrigin.lng.toFixed(2)}`;
      if ((needsPitstop || needsDestination) && !seededSlotsRef.current.has(slotKey)) {
        seededSlotsRef.current.add(slotKey);
        const seedPitstop = needsPitstop
          ? places[0] || null
          : activeRoutine.preferredPitstop;
        const seedDestination = needsDestination
          ? suggestedDestination
          : activeRoutine.destination;

        onAutoSeedRoutinePlaces(seedPitstop, seedDestination);
      }
    }

    loadPlaces();
    return () => {
      cancelled = true;
    };
  }, [
    stableOrigin.lat,
    stableOrigin.lng,
    activeRoutine.id,
    activeRoutine.timeSlot,
    activeRoutine.pitstopCategory,
    searchCategoryFilter,
  ]);

  // 4. Compute Driving Routes via Free OSRM Engine
  useEffect(() => {
    const destinationPlace = activeRoutine.destination;
    const pitstopPlace =
      activeRoutine.includePitstopInRoute && activeRoutine.preferredPitstop
        ? activeRoutine.preferredPitstop
        : null;

    if (!destinationPlace && !pitstopPlace) {
      setComputedRoutes([]);
      onRoutesComputed([], false, null);
      return;
    }

    const finalTarget = destinationPlace || pitstopPlace!;
    if (getDistanceMeters(stableOrigin, finalTarget.location) > 80000) {
      return;
    }

    let cancelled = false;

    computeOpenDrivingRoutes(stableOrigin, pitstopPlace, destinationPlace).then(
      (routes) => {
        if (cancelled) return;
        setComputedRoutes(routes);

        if (routes.length > 0) {
          const preferredIdx =
            optimizationMode === 'SHORTEST_DISTANCE'
              ? routes.find((r) => r.isShortestDistance)?.index ?? 0
              : routes.find((r) => r.isFastestDuration)?.index ?? 0;
          onSelectRouteIndex(preferredIdx);
          onRoutesComputed(routes, false, null);
        } else {
          onRoutesComputed([], false, null);
        }
      }
    );

    return () => {
      cancelled = true;
    };
  }, [
    stableOrigin.lat,
    stableOrigin.lng,
    activeRoutine.destination?.placeId,
    activeRoutine.preferredPitstop?.placeId,
    activeRoutine.includePitstopInRoute,
    optimizationMode,
  ]);

  // 5. Render Route Polylines Atomically (No Flicker)
  useEffect(() => {
    const routeGroup = routeLayerGroupRef.current;
    if (!routeGroup) return;

    routeGroup.clearLayers();
    if (computedRoutes.length === 0) return;

    const ordered = [...computedRoutes].sort((a, b) =>
      a.index === selectedRouteIndex ? 1 : b.index === selectedRouteIndex ? -1 : 0
    );

    ordered.forEach((routeOpt) => {
      const isSelected = routeOpt.index === selectedRouteIndex;
      const latLngs: L.LatLngExpression[] = routeOpt.pathCoordinates.map((pt) => [
        pt.lat,
        pt.lng,
      ]);

      if (latLngs.length < 2) return;

      // Subtle glow for selected route
      if (isSelected) {
        L.polyline(latLngs, {
          color: routeOpt.trafficCondition === 'HEAVY' ? '#f59e0b' : '#3b82f6',
          weight: 10,
          opacity: 0.25,
          lineCap: 'round',
          lineJoin: 'round',
          interactive: false,
        }).addTo(routeGroup);
      }

      const poly = L.polyline(latLngs, {
        color: isSelected
          ? routeOpt.trafficCondition === 'HEAVY'
            ? '#d97706'
            : '#2563eb'
          : '#64748b',
        weight: isSelected ? 5 : 3.5,
        opacity: isSelected ? 0.95 : 0.45,
        lineCap: 'round',
        lineJoin: 'round',
      });

      poly.on('click', () => {
        onSelectRouteIndex(routeOpt.index);
      });

      poly.addTo(routeGroup);
    });
  }, [computedRoutes, selectedRouteIndex, onSelectRouteIndex]);

  // 6. Update User Live Position Marker Smoothly Without Rebuilding Other Markers
  const currentMarkerPos = simulatedPosition || userLocation;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const userIcon = L.divIcon({
      className: 'bg-transparent border-0',
      html: `<div style="width:28px;height:28px;border-radius:9999px;background:#0f172a;border:2.5px solid #ffffff;box-shadow:0 2px 8px rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;">
        <div style="width:10px;height:10px;border-radius:9999px;background:#3b82f6;"></div>
      </div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });

    if (!userMarkerRef.current) {
      userMarkerRef.current = L.marker([currentMarkerPos.lat, currentMarkerPos.lng], {
        icon: userIcon,
        zIndexOffset: 1000,
      }).addTo(map);
    } else {
      userMarkerRef.current.setLatLng([currentMarkerPos.lat, currentMarkerPos.lng]);
    }
  }, [currentMarkerPos.lat, currentMarkerPos.lng]);

  // 7. Render Pitstop, Destination & Nearby Suggestion Markers
  useEffect(() => {
    const markersGroup = markersLayerGroupRef.current;
    if (!markersGroup) return;

    markersGroup.clearLayers();

    // Active Pitstop Marker
    if (
      activeRoutine.preferredPitstop &&
      (!isCompactPip || activeRoutine.includePitstopInRoute)
    ) {
      const pitstop = activeRoutine.preferredPitstop;
      const bg = activeRoutine.includePitstopInRoute ? '#d97706' : '#475569';
      const labelHtml = isCompactPip
        ? `☕`
        : `☕ <span style="margin-left:4px;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${pitstop.displayName}</span>`;

      const icon = L.divIcon({
        className: 'bg-transparent border-0',
        html: `<div style="display:inline-flex;align-items:center;padding:4px 8px;border-radius:10px;background:${bg};color:#ffffff;border:2px solid #ffffff;font-size:11px;font-weight:600;box-shadow:0 2px 6px rgba(0,0,0,0.35);white-space:nowrap;">${labelHtml}</div>`,
        iconSize: isCompactPip ? [28, 28] : [130, 28],
        iconAnchor: isCompactPip ? [14, 14] : [65, 14],
      });

      const m = L.marker([pitstop.location.lat, pitstop.location.lng], {
        icon,
        zIndexOffset: 800,
      });
      if (!isCompactPip) {
        m.on('click', () => setActiveInfoPlace({ place: pitstop, role: 'PITSTOP' }));
      }
      m.addTo(markersGroup);
    }

    // Active Destination Marker
    if (activeRoutine.destination) {
      const dest = activeRoutine.destination;
      const labelHtml = isCompactPip
        ? `🏁`
        : `🏢 <span style="margin-left:4px;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${dest.displayName}</span>`;

      const icon = L.divIcon({
        className: 'bg-transparent border-0',
        html: `<div style="display:inline-flex;align-items:center;padding:4px 8px;border-radius:10px;background:#2563eb;color:#ffffff;border:2px solid #ffffff;font-size:11px;font-weight:600;box-shadow:0 2px 6px rgba(0,0,0,0.35);white-space:nowrap;">${labelHtml}</div>`,
        iconSize: isCompactPip ? [28, 28] : [130, 28],
        iconAnchor: isCompactPip ? [14, 14] : [65, 14],
      });

      const m = L.marker([dest.location.lat, dest.location.lng], {
        icon,
        zIndexOffset: 850,
      });
      if (!isCompactPip) {
        m.on('click', () => setActiveInfoPlace({ place: dest, role: 'DESTINATION' }));
      }
      m.addTo(markersGroup);
    }

    // Nearby Suggested Stops (Hidden in compact PiP mode)
    if (!isCompactPip) {
      nearbySuggestions
        .filter(
          (s) =>
            s.placeId !== activeRoutine.preferredPitstop?.placeId &&
            s.placeId !== activeRoutine.destination?.placeId
        )
        .slice(0, 5)
        .forEach((suggestion) => {
          const icon = L.divIcon({
            className: 'bg-transparent border-0',
            html: `<div style="display:inline-flex;align-items:center;padding:3px 7px;border-radius:8px;background:#ffffff;color:#0f172a;border:1.5px solid #cbd5e1;font-size:10px;font-weight:600;box-shadow:0 1px 4px rgba(0,0,0,0.2);white-space:nowrap;">✨ <span style="margin-left:3px;max-width:90px;overflow:hidden;text-overflow:ellipsis;">${suggestion.displayName}</span></div>`,
            iconSize: [110, 24],
            iconAnchor: [55, 12],
          });

          const m = L.marker([suggestion.location.lat, suggestion.location.lng], {
            icon,
            zIndexOffset: 500,
          });
          m.on('click', () =>
            setActiveInfoPlace({ place: suggestion, role: 'SUGGESTION' })
          );
          m.addTo(markersGroup);
        });
    }
  }, [
    activeRoutine.preferredPitstop,
    activeRoutine.destination,
    activeRoutine.includePitstopInRoute,
    nearbySuggestions,
    isCompactPip,
  ]);

  // 8. Fit Map Bounds ONCE per Route / View Change (Never Fight User Zoom)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapVisible || computedRoutes.length === 0) return;

    const fitSignature = [
      activeRoutine.id,
      activeRoutine.destination?.placeId || 'none',
      activeRoutine.includePitstopInRoute
        ? activeRoutine.preferredPitstop?.placeId || 'none'
        : 'direct',
      isCompactPip ? 'pip' : 'full',
    ].join('::');

    if (lastFittedKeyRef.current === fitSignature) {
      return;
    }

    const activeRoute =
      computedRoutes.find((r) => r.index === selectedRouteIndex) ||
      computedRoutes[0];
    if (activeRoute && activeRoute.pathCoordinates.length >= 2) {
      lastFittedKeyRef.current = fitSignature;
      const timer = window.setTimeout(() => {
        try {
          map.invalidateSize({ animate: false });
          const bounds = L.latLngBounds(
            activeRoute.pathCoordinates.map((pt) => [pt.lat, pt.lng])
          );
          map.fitBounds(bounds, {
            padding: isCompactPip ? [22, 22] : [48, 48],
            animate: false,
          });
        } catch {
          // ignore
        }
      }, 90);
      return () => window.clearTimeout(timer);
    }
  }, [
    isMapVisible,
    isCompactPip,
    computedRoutes,
    selectedRouteIndex,
    activeRoutine.id,
    activeRoutine.destination?.placeId,
    activeRoutine.preferredPitstop?.placeId,
    activeRoutine.includePitstopInRoute,
  ]);

  return (
    <div
      className={`relative w-full h-full ${
        isCompactPip ? 'min-h-[180px]' : 'min-h-[380px]'
      }`}
    >
      <div ref={mapContainerRef} className="w-full h-full z-10" />

      {/* Selected Place Card Overlay (Hidden in PiP Mode) */}
      {!isCompactPip && activeInfoPlace && (
        <div
          className={`absolute bottom-3 left-3 right-3 z-30 p-3.5 rounded-2xl border shadow-xl ${
            isDarkMode
              ? 'bg-slate-900/95 border-slate-700 text-slate-100'
              : 'bg-white/95 border-slate-200 text-slate-900'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[11px] font-medium text-blue-400">
                {activeInfoPlace.role === 'PITSTOP'
                  ? 'Daily Routine Pitstop'
                  : activeInfoPlace.role === 'DESTINATION'
                  ? 'Primary Destination'
                  : 'Suggested Nearby Stop'}
              </div>
              <h4 className="text-sm font-bold leading-snug">
                {activeInfoPlace.place.displayName}
              </h4>
              <p className="text-xs text-slate-400 mt-0.5">
                {activeInfoPlace.place.formattedAddress}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveInfoPlace(null)}
              className="p-1 text-slate-400 hover:text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {activeInfoPlace.role !== 'PITSTOP' && (
              <button
                type="button"
                onClick={() => {
                  onSwapPitstop(activeInfoPlace.place);
                  setActiveInfoPlace(null);
                }}
                className="min-h-[34px] px-3 py-1 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-500 flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                Set as Pitstop
              </button>
            )}
            {activeInfoPlace.role === 'PITSTOP' && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
                <Check className="w-3.5 h-3.5" /> Active Pitstop
              </span>
            )}
            {activeInfoPlace.role === 'SUGGESTION' && (
              <button
                type="button"
                onClick={() => {
                  onSetDestination(activeInfoPlace.place);
                  setActiveInfoPlace(null);
                }}
                className={`min-h-[34px] px-3 py-1 text-xs font-medium rounded-lg border ${
                  isDarkMode
                    ? 'border-slate-700 bg-slate-800 text-slate-200'
                    : 'border-slate-200 bg-slate-100 text-slate-800'
                }`}
              >
                Set Destination
              </button>
            )}
            {activeInfoPlace.place.googleMapsURI && (
              <a
                href={activeInfoPlace.place.googleMapsURI}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto inline-flex items-center gap-1 text-xs text-blue-400 hover:underline"
              >
                Open Map <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
