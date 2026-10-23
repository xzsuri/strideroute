export interface GeoLocation {
  lat: number;
  lng: number;
}

/**
 * All fields in LivePlace originate strictly from active Google Maps Platform
 * Places API (New) calls (Place.searchNearby, Place.searchByText, or Place.fetchFields).
 */
export interface LivePlace {
  placeId: string;
  displayName: string;
  formattedAddress: string;
  location: GeoLocation;
  rating?: number;
  userRatingCount?: number;
  businessStatus?: string;
  primaryType?: string;
  googleMapsURI?: string;
  photoURI?: string;
}

export type RoutineTimeSlot = 'MORNING' | 'MIDDAY' | 'EVENING';

export type TravelModeOption = 'DRIVING' | 'WALKING' | 'BICYCLING' | 'TRANSIT';

export type RouteOptimizationMode = 'SHORTEST_DISTANCE' | 'FASTEST_TRAFFIC';

export interface DailyRoutineRule {
  id: string;
  timeSlot: RoutineTimeSlot;
  windowStart: string;
  windowEnd: string;
  label: string;
  pitstopCategory: string;
  preferredPitstop: LivePlace | null;
  destination: LivePlace | null;
  visitFrequencyDays: number;
  includePitstopInRoute: boolean;
}

export interface StopLogEntry {
  id: string;
  timestamp: string;
  timeOfDay: string;
  place: LivePlace;
  dwellMinutes: number;
  detectedAutomatically: boolean;
  timeSlot: RoutineTimeSlot;
}

export interface RouteStepDetail {
  instruction: string;
  distanceMeters: number;
  durationMillis: number;
  startLocation?: GeoLocation;
}

export interface RouteLegDetail {
  legIndex: number;
  label: string;
  distanceMeters: number;
  durationMillis: number;
  staticDurationMillis: number;
  steps: RouteStepDetail[];
}

export interface ComputedRouteOption {
  index: number;
  label: string;
  isShortestDistance: boolean;
  isFastestDuration: boolean;
  distanceMeters: number;
  durationMillis: number;
  staticDurationMillis: number;
  trafficDelayMinutes: number;
  trafficCondition: 'CLEAR' | 'MODERATE' | 'HEAVY';
  description: string;
  warnings: string[];
  legs: RouteLegDetail[];
  pathCoordinates: GeoLocation[];
  rawRoute: any;
}
