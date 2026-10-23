// Source: Google Maps Platform Code Assist
import { useEffect, useRef, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { GeoLocation } from '../types/commute';

export type UseAutocompleteSuggestionsReturn = {
  suggestions: google.maps.places.AutocompleteSuggestion[];
  isLoading: boolean;
  resetSession: () => void;
};

function checkQuotaError(err: unknown) {
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

export function useAutocompleteSuggestions(
  inputString: string,
  originLocation?: GeoLocation
): UseAutocompleteSuggestionsReturn {
  const placesLib = useMapsLibrary('places');
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const [suggestions, setSuggestions] = useState<google.maps.places.AutocompleteSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!placesLib) return;

    const { AutocompleteSessionToken, AutocompleteSuggestion } = placesLib;

    if (!sessionTokenRef.current) {
      sessionTokenRef.current = new AutocompleteSessionToken();
    }

    const trimmed = inputString.trim();
    if (trimmed === '') {
      if (suggestions.length > 0) setSuggestions([]);
      return;
    }

    const request: any = {
      input: trimmed,
      sessionToken: sessionTokenRef.current,
      internalUsageAttributionIds: ['gmp_mcp_codeassist_v1_aistudio'],
    };

    if (originLocation) {
      request.origin = originLocation;
      request.locationBias = {
        center: originLocation,
        radius: 15000,
      };
    }

    setIsLoading(true);

    AutocompleteSuggestion.fetchAutocompleteSuggestions(request)
      .then((res: { suggestions: google.maps.places.AutocompleteSuggestion[] }) => {
        setSuggestions(res.suggestions || []);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        console.error('Error fetching autocomplete suggestions:', err);
        checkQuotaError(err);
        setIsLoading(false);
      });
  }, [placesLib, inputString, originLocation?.lat, originLocation?.lng]);

  return {
    suggestions,
    isLoading,
    resetSession: () => {
      sessionTokenRef.current = null;
      setSuggestions([]);
    },
  };
}
