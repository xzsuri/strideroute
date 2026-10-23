import React, { useState, useEffect, useRef } from 'react';
import { Search, MapPin, Loader2, X } from 'lucide-react';
import { GeoLocation, LivePlace } from '../types/commute';
import { getDistanceMeters, searchOpenPlaces } from '../utils/openMapServices';

interface PlaceSearchInputProps {
  label: string;
  placeholder: string;
  currentPlace: LivePlace | null;
  originLocation: GeoLocation;
  onSelectPlace: (place: LivePlace) => void;
  onClearPlace?: () => void;
  isDarkMode?: boolean;
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
  const [inputValue, setInputValue] = useState('');
  const [suggestions, setSuggestions] = useState<LivePlace[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const trimmed = inputValue.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    const timer = window.setTimeout(async () => {
      const results = await searchOpenPlaces(trimmed, originLocation);
      if (!cancelled) {
        setSuggestions(results);
        setIsLoading(false);
      }
    }, 260);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [inputValue, originLocation.lat, originLocation.lng]);

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
        {isLoading && (
          <Loader2 className="w-4 h-4 text-blue-500 animate-spin absolute right-3.5" />
        )}
        {!isLoading && (inputValue || (currentPlace && onClearPlace)) && (
          <button
            type="button"
            onClick={() => {
              if (inputValue) {
                setInputValue('');
                setSuggestions([]);
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
          {suggestions.map((place, index) => {
            const distKm = `${(getDistanceMeters(originLocation, place.location) / 1000).toFixed(1)} km`;
            return (
              <button
                key={place.placeId || index}
                type="button"
                onClick={() => {
                  onSelectPlace(place);
                  setInputValue('');
                  setSuggestions([]);
                  setIsOpen(false);
                }}
                className={`w-full min-h-[52px] px-4 py-2.5 text-left flex items-start gap-3 transition-colors ${
                  isDarkMode ? 'hover:bg-slate-800' : 'hover:bg-slate-50'
                }`}
              >
                <MapPin className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className={`text-sm font-medium truncate ${isDarkMode ? 'text-slate-100' : 'text-slate-900'}`}>
                    {place.displayName}
                  </div>
                  <div className={`text-xs truncate ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                    {place.formattedAddress} · {distKm}
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
            OpenStreetMap
          </div>
        </div>
      )}
    </div>
  );
};
