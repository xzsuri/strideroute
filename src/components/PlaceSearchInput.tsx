// Source: Google Maps Platform Code Assist
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { Search, MapPin, Loader2, X } from 'lucide-react';
import { useAutocompleteSuggestions } from '../hooks/useAutocompleteSuggestions';
import { GeoLocation, LivePlace } from '../types/commute';

interface PlaceSearchInputProps {
  label: string;
  placeholder: string;
  currentPlace: LivePlace | null;
  originLocation: GeoLocation;
  onSelectPlace: (place: LivePlace) => void;
  onClearPlace?: () => void;
  isDarkMode?: boolean;
}

export function extractLivePlace(place: any): LivePlace | null {
  if (!place || !place.location) return null;
  const lat = typeof place.location.lat === 'function' ? place.location.lat() : place.location.lat;
  const lng = typeof place.location.lng === 'function' ? place.location.lng() : place.location.lng;

  let photoURI: string | undefined;
  if (Array.isArray(place.photos) && place.photos.length > 0) {
    try {
      photoURI = place.photos[0].getURI({ maxWidth: 400, maxHeight: 300 });
    } catch {
      photoURI = undefined;
    }
  }

  return {
    placeId: place.id || `${lat},${lng}`,
    displayName: place.displayName || 'Selected Location',
    formattedAddress: place.formattedAddress || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
    location: { lat, lng },
    rating: typeof place.rating === 'number' ? place.rating : undefined,
    userRatingCount: typeof place.userRatingCount === 'number' ? place.userRatingCount : undefined,
    businessStatus: place.businessStatus || undefined,
    primaryType: place.primaryType || undefined,
    googleMapsURI: place.googleMapsURI || undefined,
    photoURI,
  };
}

export const PlaceSearchInput: React.FC<PlaceSearchInputProps> = ({
  label,
  placeholder,
  currentPlace,
  originLocation,
  onSelectPlace,
  onClearPlace,
  isDarkMode = false,
}) => {
  const placesLib = useMapsLibrary('places');
  const [inputValue, setInputValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [isFetchingDetails, setIsFetchingDetails] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { suggestions, isLoading, resetSession } = useAutocompleteSuggestions(
    inputValue,
    originLocation
  );

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSuggestionClick = useCallback(
    async (suggestion: google.maps.places.AutocompleteSuggestion) => {
      if (!placesLib || !suggestion.placePrediction) return;
      setIsFetchingDetails(true);
      try {
        const place = suggestion.placePrediction.toPlace();
        await place.fetchFields({
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
        });

        const mapped = extractLivePlace(place);
        if (mapped) {
          onSelectPlace(mapped);
        }
        setInputValue('');
        setIsOpen(false);
        resetSession();
      } catch (err: any) {
        console.error('Error fetching place details:', err);
        const msg = String(err?.message || err || '');
        if (msg.includes('OVER_QUERY_LIMIT') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
      } finally {
        setIsFetchingDetails(false);
      }
    },
    [placesLib, onSelectPlace, resetSession]
  );

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="flex items-center justify-between mb-1.5">
        <label className={`text-xs font-medium ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>
          {label}
        </label>
        {currentPlace && (
          <span className={`text-xs truncate max-w-[200px] ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
            Active: {currentPlace.displayName}
          </span>
        )}
      </div>

      <div className="relative flex items-center">
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" />
        <input
          type="text"
          value={inputValue}
          onFocus={() => setIsOpen(true)}
          onChange={(e) => {
            setInputValue(e.target.value);
            setIsOpen(true);
          }}
          placeholder={currentPlace ? `${currentPlace.displayName} — Search to change...` : placeholder}
          className={`w-full min-h-[44px] pl-10 pr-10 py-2 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-colors ${
            isDarkMode
              ? 'bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500'
              : 'bg-white border-slate-200 text-slate-900 placeholder:text-slate-400'
          }`}
        />
        {(isLoading || isFetchingDetails) && (
          <Loader2 className="w-4 h-4 text-blue-500 animate-spin absolute right-3.5" />
        )}
        {!isLoading && !isFetchingDetails && (inputValue || (currentPlace && onClearPlace)) && (
          <button
            type="button"
            onClick={() => {
              if (inputValue) {
                setInputValue('');
                resetSession();
              } else if (onClearPlace) {
                onClearPlace();
              }
            }}
            aria-label="Clear place input"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center absolute right-0 text-slate-400 hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {isOpen && suggestions.length > 0 && (
        <div
          className={`absolute left-0 right-0 mt-1.5 border rounded-2xl shadow-lg z-40 max-h-64 overflow-y-auto divide-y ${
            isDarkMode
              ? 'bg-slate-900 border-slate-700 divide-slate-800'
              : 'bg-white border-slate-200 divide-slate-100'
          }`}
        >
          {suggestions.map((suggestion, index) => {
            const pred = suggestion.placePrediction;
            if (!pred) return null;
            const mainText = pred.mainText?.text || pred.text?.text || 'Place';
            const secondaryText = pred.secondaryText?.text || '';
            const distKm =
              typeof pred.distanceMeters === 'number'
                ? `${(pred.distanceMeters / 1000).toFixed(1)} km`
                : null;

            return (
              <button
                key={pred.placeId || index}
                type="button"
                onClick={() => handleSuggestionClick(suggestion)}
                className={`w-full min-h-[52px] px-4 py-2.5 text-left flex items-start gap-3 transition-colors ${
                  isDarkMode ? 'hover:bg-slate-800' : 'hover:bg-slate-50'
                }`}
              >
                <MapPin className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className={`text-sm font-medium truncate ${isDarkMode ? 'text-slate-100' : 'text-slate-900'}`}>
                    {mainText}
                  </div>
                  <div className={`text-xs truncate ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                    {secondaryText}
                    {distKm ? ` · ${distKm}` : ''}
                  </div>
                </div>
              </button>
            );
          })}
          <div
            className={`px-4 py-1.5 text-[11px] text-right ${
              isDarkMode ? 'bg-slate-950 text-slate-500' : 'bg-slate-50 text-slate-500'
            }`}
          >
            Google Maps
          </div>
        </div>
      )}
    </div>
  );
};
