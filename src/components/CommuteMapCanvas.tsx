// Source: Google Maps Platform Code Assist
import React, { useEffect, useRef, useState } from 'react';
import {
  Map,
  AdvancedMarker,
  InfoWindow,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import {
  Navigation,
  Coffee,
  Building2,
  Sparkles,
  ExternalLink,
  Check,
  Plus,
} from 'lucide-react';
import {
  ComputedRouteOption,
  DailyRoutineRule,
  GeoLocation,
  LivePlace,
  RouteLegDetail,
  RouteOptimizationMode,
  RouteStepDetail,
  TravelModeOption,
} from '../types/commute';
import { extractLivePlace } from './PlaceSearchInput';

interface CommuteMapCanvasProps {
  userLocation: GeoLocation;
  simulatedPosition: GeoLocation | null;
  activeRoutine: DailyRoutineRule;
  travelMode: TravelModeOption;
  optimizationMode: RouteOptimizationMode;
  showTrafficLayer: boolean;
  selectedRouteIndex: number;
  onSelectRouteIndex: (idx: number) => void;
  onRoutesComputed: (routes: ComputedRouteOption[], isLoading: boolean, error: string | null) => void;
  nearbySuggestions: LivePlace[];
  onNearbySuggestionsLoaded: (places: LivePlace[], isLoading: boolean) => void;
  onAutoSeedRoutinePlaces: (pitstop: LivePlace | null, destination: LivePlace | null) => void;
  onSwapPitstop: (place: LivePlace) => void;
  onSetDestination: (place: LivePlace) => void;
  searchCategoryFilter: string;
  isDarkMode?: boolean;
  isCompactPip?: boolean;
}

function notifyQuotaIfApplicable(err: unknown) {
  const msg = String((err as any)?.message || err || '');
  const code = String((err as any)?.code || (err as any)?.status || '');
  if (
    msg.includes('OVER_QUERY_LIMIT') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('429') ||
    msg.includes('QuotaExceeded') ||
    code === 'OVER_QUERY_LIMIT' ||
    code === 'RESOURCE_EXHAUSTED' ||
    code === '429'
  ) {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  }
}

const MapController: React.FC<CommuteMapCanvasProps & { onMarkerSelect: (place: LivePlace | null) => void }> = ({
  userLocation,
  activeRoutine,
  travelMode,
  optimizationMode,
  showTrafficLayer,
  selectedRouteIndex,
  onSelectRouteIndex,
  onRoutesComputed,
  onNearbySuggestionsLoaded,
  onAutoSeedRoutinePlaces,
  searchCategoryFilter,
}) => {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');
  const placesLib = useMapsLibrary('places');

  const trafficLayerRef = useRef<google.maps.TrafficLayer | null>(null);
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const seededSlotsRef = useRef<Set<string>>(new Set());

  // 1. Real-Time Traffic Layer overlay
  useEffect(() => {
    if (!map) return;
    if (!trafficLayerRef.current) {
      trafficLayerRef.current = new google.maps.TrafficLayer();
    }
    trafficLayerRef.current.setMap(showTrafficLayer ? map : null);

    return () => {
      if (trafficLayerRef.current) {
        trafficLayerRef.current.setMap(null);
      }
    };
  }, [map, showTrafficLayer]);

  // 2. Discover Real Nearby Places & Seed Initial Routine via Places API (New)
  useEffect(() => {
    if (!placesLib) return;
    const { Place, SearchNearbyRankPreference } = placesLib as any;
    if (!Place) return;

    let cancelled = false;
    onNearbySuggestionsLoaded([], true);

    async function loadNearbyAndSeed() {
      try {
        const primaryTypesMap: Record<string, string[]> = {
          breakfast_restaurant: ['breakfast_restaurant', 'cafe', 'bakery'],
          cafe: ['cafe', 'coffee_shop', 'bakery'],
          restaurant: ['restaurant', 'meal_takeaway', 'cafe'],
          supermarket: ['supermarket', 'grocery_store', 'convenience_store'],
          gym: ['gym', 'fitness_center'],
        };

        const typesToQuery =
          primaryTypesMap[searchCategoryFilter] ||
          primaryTypesMap[activeRoutine.pitstopCategory] ||
          ['cafe', 'breakfast_restaurant', 'restaurant'];

        const nearbyReq: any = {
          fields: [
            'id',
            'displayName',
            'formattedAddress',
            'location',
            'rating',
            'userRatingCount',
            'businessStatus',
            'primaryType',
            'googleMapsURI',
            'photos',
          ],
          locationRestriction: {
            center: userLocation,
            radius: 3500,
          },
          includedPrimaryTypes: typesToQuery,
          maxResultCount: 10,
          rankPreference: SearchNearbyRankPreference?.POPULARITY || 'POPULARITY',
          internalUsageAttributionIds: ['gmp_mcp_codeassist_v1_aistudio'],
        };

        const { places } = await Place.searchNearby(nearbyReq);
        if (cancelled) return;

        const mappedPlaces: LivePlace[] = (places || [])
          .map((p: any) => extractLivePlace(p))
          .filter((p: LivePlace | null): p is LivePlace => p !== null);

        onNearbySuggestionsLoaded(mappedPlaces, false);

        // If the current routine slot doesn't have a real pitstop or destination yet,
        // automatically seed from live Places API (New) results so the user immediately sees
        // a complete real-world routine without any hardcoded/hallucinated place data.
        const slotKey = `${activeRoutine.id}_${userLocation.lat.toFixed(2)}_${userLocation.lng.toFixed(2)}`;
        if (
          (!activeRoutine.preferredPitstop || !activeRoutine.destination) &&
          !seededSlotsRef.current.has(slotKey)
        ) {
          seededSlotsRef.current.add(slotKey);
          const seedPitstop = activeRoutine.preferredPitstop || mappedPlaces[0] || null;

          let seedDestination = activeRoutine.destination;
          if (!seedDestination) {
            const destQuery =
              activeRoutine.timeSlot === 'MORNING'
                ? 'corporate office business center downtown'
                : activeRoutine.timeSlot === 'MIDDAY'
                ? 'coworking space technology hub'
                : 'residential plaza transit station';

            const textReq: any = {
              textQuery: destQuery,
              fields: [
                'id',
                'displayName',
                'formattedAddress',
                'location',
                'rating',
                'userRatingCount',
                'businessStatus',
                'primaryType',
                'googleMapsURI',
              ],
              locationBias: {
                center: {
                  lat: userLocation.lat + 0.022,
                  lng: userLocation.lng - 0.018,
                },
                radius: 5000,
              },
              maxResultCount: 4,
              internalUsageAttributionIds: ['gmp_mcp_codeassist_v1_aistudio'],
            };

            const destRes = await Place.searchByText(textReq);
            if (!cancelled && destRes?.places?.length > 0) {
              const candidates = destRes.places
                .map((p: any) => extractLivePlace(p))
                .filter((p: LivePlace | null): p is LivePlace => p !== null);
              seedDestination =
                candidates.find((c: LivePlace) => c.placeId !== seedPitstop?.placeId) ||
                candidates[0] ||
                null;
            }
          }

          if (!cancelled && (seedPitstop || seedDestination)) {
            onAutoSeedRoutinePlaces(seedPitstop, seedDestination);
          }
        }
      } catch (err) {
        console.error('Error discovering nearby places via Places API (New):', err);
        notifyQuotaIfApplicable(err);
        if (!cancelled) {
          onNearbySuggestionsLoaded([], false);
        }
      }
    }

    loadNearbyAndSeed();
    return () => {
      cancelled = true;
    };
  }, [
    placesLib,
    userLocation.lat,
    userLocation.lng,
    activeRoutine.id,
    activeRoutine.pitstopCategory,
    searchCategoryFilter,
  ]);

  // 3. Compute Multi-Stop Traffic-Aware & Shortest Routes via Route.computeRoutes
  useEffect(() => {
    if (!routesLib || !map) return;

    const destinationPlace = activeRoutine.destination;
    const pitstopPlace =
      activeRoutine.includePitstopInRoute && activeRoutine.preferredPitstop
        ? activeRoutine.preferredPitstop
        : null;

    // Clean up existing polylines
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];

    if (!destinationPlace && !pitstopPlace) {
      onRoutesComputed([], false, null);
      return;
    }

    const finalTarget = destinationPlace || pitstopPlace!;
    const intermediateWaypoints =
      destinationPlace && pitstopPlace && pitstopPlace.placeId !== destinationPlace.placeId
        ? [
            {
              location: pitstopPlace.location,
              vehicleStopover: true,
            },
          ]
        : [];

    let cancelled = false;
    onRoutesComputed([], true, null);

    const request: any = {
      origin: userLocation,
      destination: finalTarget.location,
      travelMode: travelMode,
      computeAlternativeRoutes: true,
      fields: [
        'path',
        'distanceMeters',
        'durationMillis',
        'staticDurationMillis',
        'viewport',
        'legs',
        'description',
        'warnings',
      ],
      internalUsageAttributionIds: ['gmp_mcp_codeassist_v1_aistudio'],
    };

    if (intermediateWaypoints.length > 0) {
      request.intermediates = intermediateWaypoints;
    }

    (routesLib.Route as any)
      .computeRoutes(request)
      .then((response: any) => {
        if (cancelled) return;
        const rawRoutes: any[] = response?.routes || [];
        if (rawRoutes.length === 0) {
          onRoutesComputed([], false, 'No route found between the selected locations.');
          return;
        }

        // Determine shortest distance index and fastest duration index
        let minDistance = Infinity;
        let shortestIdx = 0;
        let minDuration = Infinity;
        let fastestIdx = 0;

        rawRoutes.forEach((r, idx) => {
          const dist = r.distanceMeters ?? Infinity;
          const dur = r.durationMillis ?? Infinity;
          if (dist < minDistance) {
            minDistance = dist;
            shortestIdx = idx;
          }
          if (dur < minDuration) {
            minDuration = dur;
            fastestIdx = idx;
          }
        });

        const parsedRoutes: ComputedRouteOption[] = rawRoutes.map((r, idx) => {
          const distanceMeters = r.distanceMeters ?? 0;
          const durationMillis = r.durationMillis ?? 0;
          const staticDurationMillis = r.staticDurationMillis ?? durationMillis;
          const delayMs = Math.max(0, durationMillis - staticDurationMillis);
          const trafficDelayMinutes = Math.round(delayMs / 60000);

          const ratio =
            staticDurationMillis > 0 ? durationMillis / staticDurationMillis : 1;
          let trafficCondition: 'CLEAR' | 'MODERATE' | 'HEAVY' = 'CLEAR';
          if (ratio > 1.25 || trafficDelayMinutes >= 6) {
            trafficCondition = 'HEAVY';
          } else if (ratio > 1.1 || trafficDelayMinutes >= 2) {
            trafficCondition = 'MODERATE';
          }

          const isShortestDistance = idx === shortestIdx;
          const isFastestDuration = idx === fastestIdx;

          let label = `Alternative Route ${idx + 1}`;
          if (isShortestDistance && isFastestDuration) {
            label = 'Shortest & Fastest Route';
          } else if (isShortestDistance) {
            label = 'Shortest Distance Route';
          } else if (isFastestDuration) {
            label = 'Fastest Traffic-Aware Route';
          }

          const legs: RouteLegDetail[] = (r.legs || []).map((leg: any, legIdx: number) => {
            const legLabel =
              intermediateWaypoints.length > 0
                ? legIdx === 0
                  ? `Leg 1: Current Location to ${pitstopPlace?.displayName}`
                  : `Leg 2: ${pitstopPlace?.displayName} to ${destinationPlace?.displayName}`
                : `Direct to ${finalTarget.displayName}`;

            const steps: RouteStepDetail[] = (leg.steps || []).map((step: any) => {
              let startLoc: GeoLocation | undefined;
              if (step.startLocation) {
                const lat =
                  typeof step.startLocation.lat === 'function'
                    ? step.startLocation.lat()
                    : step.startLocation.lat;
                const lng =
                  typeof step.startLocation.lng === 'function'
                    ? step.startLocation.lng()
                    : step.startLocation.lng;
                if (typeof lat === 'number' && typeof lng === 'number') {
                  startLoc = { lat, lng };
                }
              }
              return {
                instruction:
                  step.instructions ||
                  step.navigationInstruction?.instructions ||
                  'Continue along route',
                distanceMeters: step.distanceMeters ?? 0,
                durationMillis:
                  step.staticDurationMillis ?? step.durationMillis ?? 0,
                startLocation: startLoc,
              };
            });

            return {
              legIndex: legIdx,
              label: legLabel,
              distanceMeters: leg.distanceMeters ?? 0,
              durationMillis: leg.durationMillis ?? 0,
              staticDurationMillis: leg.staticDurationMillis ?? leg.durationMillis ?? 0,
              steps,
            };
          });

          const rawPath: any[] = r.path || [];
          const pathCoordinates: GeoLocation[] = rawPath
            .map((pt: any) => {
              const lat = typeof pt.lat === 'function' ? pt.lat() : pt.lat;
              const lng = typeof pt.lng === 'function' ? pt.lng() : pt.lng;
              return typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : null;
            })
            .filter((pt): pt is GeoLocation => pt !== null);

          return {
            index: idx,
            label,
            isShortestDistance,
            isFastestDuration,
            distanceMeters,
            durationMillis,
            staticDurationMillis,
            trafficDelayMinutes,
            trafficCondition,
            description: r.description || `Route via local corridor`,
            warnings: r.warnings || [],
            legs,
            pathCoordinates,
            rawRoute: r,
          };
        });

        // Automatically select the preferred route based on user's optimization preference
        const preferredIdx =
          optimizationMode === 'SHORTEST_DISTANCE' ? shortestIdx : fastestIdx;
        onSelectRouteIndex(preferredIdx);
        onRoutesComputed(parsedRoutes, false, null);

        if (rawRoutes[preferredIdx]?.viewport) {
          map.fitBounds(rawRoutes[preferredIdx].viewport, 56);
        }
      })
      .catch((err: any) => {
        if (cancelled) return;
        console.error('Error computing routes:', err);
        notifyQuotaIfApplicable(err);
        onRoutesComputed(
          [],
          false,
          err?.message || 'Unable to compute route. Please check your connection or API quota.'
        );
      });

    return () => {
      cancelled = true;
    };
  }, [
    routesLib,
    map,
    userLocation.lat,
    userLocation.lng,
    activeRoutine.destination?.placeId,
    activeRoutine.preferredPitstop?.placeId,
    activeRoutine.includePitstopInRoute,
    travelMode,
    optimizationMode,
  ]);

  return null;
};

export const CommuteMapCanvas: React.FC<CommuteMapCanvasProps> = (props) => {
  const {
    userLocation,
    simulatedPosition,
    activeRoutine,
    selectedRouteIndex,
    onSelectRouteIndex,
    nearbySuggestions,
    onSwapPitstop,
    onSetDestination,
  } = props;

  const map = useMap();
  const [activeInfoPlace, setActiveInfoPlace] = useState<{
    place: LivePlace;
    role: 'PITSTOP' | 'DESTINATION' | 'SUGGESTION';
  } | null>(null);

  const [computedRoutes, setComputedRoutes] = useState<ComputedRouteOption[]>([]);
  const polylinesRef = useRef<google.maps.Polyline[]>([]);

  const handleRoutesComputed = (
    routes: ComputedRouteOption[],
    isLoading: boolean,
    error: string | null
  ) => {
    setComputedRoutes(routes);
    props.onRoutesComputed(routes, isLoading, error);
  };

  // Render polylines whenever computedRoutes or selectedRouteIndex changes
  useEffect(() => {
    if (!map) return;
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];

    if (computedRoutes.length === 0) return;

    // Draw non-selected routes first so selected route sits on top
    const ordered = [...computedRoutes].sort((a, b) =>
      a.index === selectedRouteIndex ? 1 : b.index === selectedRouteIndex ? -1 : 0
    );

    ordered.forEach((routeOpt) => {
      const isSelected = routeOpt.index === selectedRouteIndex;
      if (typeof routeOpt.rawRoute?.createPolylines === 'function') {
        const created: google.maps.Polyline[] = routeOpt.rawRoute.createPolylines();
        created.forEach((poly) => {
          const strokeColor = isSelected
            ? routeOpt.trafficCondition === 'HEAVY'
              ? '#d97706'
              : '#2563eb'
            : '#64748b';

          poly.setOptions({
            strokeColor,
            strokeOpacity: isSelected ? 0.95 : 0.45,
            strokeWeight: isSelected ? 6 : 4,
            zIndex: isSelected ? 20 : 5,
            clickable: true,
          });
          poly.addListener('click', () => {
            onSelectRouteIndex(routeOpt.index);
          });
          poly.setMap(map);
          polylinesRef.current.push(poly);
        });
      }
    });

    return () => {
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
    };
  }, [map, computedRoutes, selectedRouteIndex]);

  // Re-fit bounds when switching between full route view and compact PiP mode
  useEffect(() => {
    if (!map || computedRoutes.length === 0) return;
    const activeRoute =
      computedRoutes.find((r) => r.index === selectedRouteIndex) || computedRoutes[0];
    if (activeRoute?.rawRoute?.viewport) {
      const timer = window.setTimeout(() => {
        try {
          map.fitBounds(activeRoute.rawRoute.viewport, props.isCompactPip ? 22 : 56);
        } catch {
          // ignore
        }
      }, 120);
      return () => window.clearTimeout(timer);
    }
  }, [map, props.isCompactPip, computedRoutes, selectedRouteIndex]);

  const currentMarkerPos = simulatedPosition || userLocation;

  return (
    <div className={`relative w-full h-full ${props.isCompactPip ? 'min-h-[180px]' : 'min-h-[380px]'}`}>
      <Map
        mapId="DEMO_MAP_ID"
        defaultCenter={userLocation}
        defaultZoom={14}
        colorScheme={props.isDarkMode ? 'DARK' : 'LIGHT'}
        gestureHandling="greedy"
        disableDefaultUI={Boolean(props.isCompactPip)}
        streetViewControl={false}
        mapTypeControl={false}
        fullscreenControl={false}
        internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
        className="w-full h-full"
      >
        <MapController
          {...props}
          onRoutesComputed={handleRoutesComputed}
          onMarkerSelect={(p) =>
            setActiveInfoPlace(p ? { place: p, role: 'SUGGESTION' } : null)
          }
        />

        {/* User Live / Simulated Position Marker */}
        <AdvancedMarker
          position={currentMarkerPos}
          title={simulatedPosition ? 'Simulated Commute Vehicle' : 'Your Current Location'}
          zIndex={40}
        >
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-900 text-white border-2 border-white shadow-md">
            <Navigation className="w-3.5 h-3.5 text-blue-400" />
          </div>
        </AdvancedMarker>

        {/* Active Routine Pitstop Marker (e.g., Morning Breakfast Stop) */}
        {activeRoutine.preferredPitstop &&
          (!props.isCompactPip || activeRoutine.includePitstopInRoute) && (
            <AdvancedMarker
              position={activeRoutine.preferredPitstop.location}
              title={`Routine Pitstop: ${activeRoutine.preferredPitstop.displayName}`}
              zIndex={35}
              onClick={() => {
                if (!props.isCompactPip) {
                  setActiveInfoPlace({
                    place: activeRoutine.preferredPitstop!,
                    role: 'PITSTOP',
                  });
                }
              }}
            >
              <div
                className={`flex items-center gap-1 px-2 py-1 rounded-xl border-2 border-white shadow-md cursor-pointer transition-transform hover:scale-105 ${
                  activeRoutine.includePitstopInRoute
                    ? 'bg-amber-600 text-white'
                    : 'bg-slate-600 text-white opacity-80'
                }`}
              >
                <Coffee className="w-3 h-3 shrink-0" />
                {!props.isCompactPip && (
                  <span className="text-xs font-semibold max-w-[120px] truncate">
                    {activeRoutine.preferredPitstop.displayName}
                  </span>
                )}
              </div>
            </AdvancedMarker>
          )}

        {/* Active Destination Marker (e.g., Office) */}
        {activeRoutine.destination && (
          <AdvancedMarker
            position={activeRoutine.destination.location}
            title={`Destination: ${activeRoutine.destination.displayName}`}
            zIndex={35}
            onClick={() => {
              if (!props.isCompactPip) {
                setActiveInfoPlace({
                  place: activeRoutine.destination!,
                  role: 'DESTINATION',
                });
              }
            }}
          >
            <div className="flex items-center gap-1 px-2 py-1 rounded-xl bg-blue-600 text-white border-2 border-white shadow-md cursor-pointer transition-transform hover:scale-105">
              <Building2 className="w-3 h-3 shrink-0" />
              {!props.isCompactPip && (
                <span className="text-xs font-semibold max-w-[120px] truncate">
                  {activeRoutine.destination.displayName}
                </span>
              )}
            </div>
          </AdvancedMarker>
        )}

        {/* Nearby Suggested New Places Markers (Hidden in Map-Only PiP mode) */}
        {!props.isCompactPip &&
          nearbySuggestions
            .filter(
              (s) =>
                s.placeId !== activeRoutine.preferredPitstop?.placeId &&
                s.placeId !== activeRoutine.destination?.placeId
            )
            .slice(0, 6)
            .map((suggestion) => (
              <AdvancedMarker
                key={suggestion.placeId}
                position={suggestion.location}
                title={`Suggested Stop: ${suggestion.displayName}`}
                zIndex={25}
                onClick={() =>
                  setActiveInfoPlace({
                    place: suggestion,
                    role: 'SUGGESTION',
                  })
                }
              >
                <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white text-slate-800 border border-slate-300 shadow-sm cursor-pointer hover:border-blue-600 transition-colors">
                  <Sparkles className="w-3 h-3 text-blue-600 shrink-0" />
                  <span className="text-[11px] font-medium max-w-[100px] truncate">
                    {suggestion.displayName}
                  </span>
                </div>
              </AdvancedMarker>
            ))}

        {/* Interactive InfoWindow for Selected Marker */}
        {!props.isCompactPip && activeInfoPlace && (
          <InfoWindow
            position={activeInfoPlace.place.location}
            onCloseClick={() => setActiveInfoPlace(null)}
          >
            <div className="p-1 max-w-[240px] text-slate-900">
              <div className="text-xs font-medium text-slate-500 mb-0.5">
                {activeInfoPlace.role === 'PITSTOP'
                  ? 'Daily Routine Pitstop'
                  : activeInfoPlace.role === 'DESTINATION'
                  ? 'Primary Destination'
                  : 'Suggested Nearby Stop'}
              </div>
              <h4 className="text-sm font-bold text-slate-900 leading-snug">
                {activeInfoPlace.place.displayName}
              </h4>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                {activeInfoPlace.place.formattedAddress}
              </p>
              <div className="flex items-center gap-1.5 text-xs text-slate-600 mt-1.5 tabular-nums">
                {activeInfoPlace.place.rating && (
                  <span>
                    {activeInfoPlace.place.rating.toFixed(1)} ★
                    {activeInfoPlace.place.userRatingCount
                      ? ` (${activeInfoPlace.place.userRatingCount})`
                      : ''}
                  </span>
                )}
                {activeInfoPlace.place.rating && activeInfoPlace.place.businessStatus && (
                  <span aria-hidden="true">·</span>
                )}
                {activeInfoPlace.place.businessStatus && (
                  <span>
                    {activeInfoPlace.place.businessStatus === 'OPERATIONAL'
                      ? 'Open'
                      : activeInfoPlace.place.businessStatus}
                  </span>
                )}
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {activeInfoPlace.role !== 'PITSTOP' && (
                  <button
                    type="button"
                    onClick={() => {
                      onSwapPitstop(activeInfoPlace.place);
                      setActiveInfoPlace(null);
                    }}
                    className="flex-1 min-h-[36px] px-2.5 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 flex items-center justify-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Set as Pitstop
                  </button>
                )}
                {activeInfoPlace.role === 'PITSTOP' && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
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
                    className="min-h-[36px] px-2.5 py-1.5 bg-slate-100 text-slate-800 text-xs font-medium rounded-lg hover:bg-slate-200"
                  >
                    Set Destination
                  </button>
                )}
              </div>

              {activeInfoPlace.place.googleMapsURI && (
                <a
                  href={activeInfoPlace.place.googleMapsURI}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-[11px] text-blue-600 hover:underline"
                >
                  Open in Google Maps <ExternalLink className="w-3 h-3" />
                </a>
              )}
              <div className="mt-1 text-[10px] text-slate-400">Google Maps</div>
            </div>
          </InfoWindow>
        )}
      </Map>
    </div>
  );
};
