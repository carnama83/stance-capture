// src/services/locationService.ts
// Production-grade location service for fetching and caching location IDs

import { getSupabase } from '@/lib/supabaseClient';

export interface LocationRecord {
  id: string;
  type: 'city' | 'county' | 'state' | 'country' | 'global';
  name: string;
  parent_id: string | null;
  iso_code: string | null;
}

export interface LocationIds {
  global: string | null;
  country: string | null; // User's country
  state: string | null;
  city: string | null;
}

export interface LocationServiceState {
  ids: LocationIds;
  isLoading: boolean;
  error: Error | null;
  lastFetched: Date | null;
}

/**
 * Cache for location IDs to avoid repeated database queries
 * This is a singleton that persists across component renders
 */
class LocationCache {
  private cache: Map<string, LocationRecord> = new Map();
  private globalLocationId: string | null = null;
  private isFetching = false;
  private fetchPromise: Promise<void> | null = null;
  private lastFetch: Date | null = null;
  private readonly CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

  /**
   * Initialize the cache by fetching commonly used locations
   * This is called once on app initialization
   */
  async initialize(): Promise<void> {
    // If already fetching, return the existing promise
    if (this.isFetching && this.fetchPromise) {
      return this.fetchPromise;
    }

    // Check if cache is still valid
    if (this.lastFetch && Date.now() - this.lastFetch.getTime() < this.CACHE_TTL_MS) {
      return;
    }

    this.isFetching = true;
    this.fetchPromise = this._fetchLocations();

    try {
      await this.fetchPromise;
    } finally {
      this.isFetching = false;
      this.fetchPromise = null;
    }
  }

  private async _fetchLocations(): Promise<void> {
    const supabase = getSupabase();
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    try {
      // Fetch global location (always needed)
      const { data: globalData, error: globalError } = await supabase
        .from('locations')
        .select('id, type, name, parent_id, iso_code')
        .eq('type', 'global')
        .eq('name', 'Global')
        .single();

      if (globalError) {
        console.error('Failed to fetch global location:', globalError);
        // Don't throw - we want to continue even if global fails
      } else if (globalData) {
        this.cache.set('global:Global', globalData);
        this.globalLocationId = globalData.id;
      }

      // Fetch all country locations for quick lookup
      const { data: countries, error: countriesError } = await supabase
        .from('locations')
        .select('id, type, name, parent_id, iso_code')
        .eq('type', 'country');

      if (countriesError) {
        console.error('Failed to fetch country locations:', countriesError);
      } else if (countries) {
        countries.forEach((loc) => {
          this.cache.set(`country:${loc.name}`, loc);
        });
      }

      this.lastFetch = new Date();
    } catch (error) {
      console.error('Error initializing location cache:', error);
      throw error;
    }
  }

  /**
   * Get the global location ID
   */
  getGlobalId(): string | null {
    return this.globalLocationId;
  }

  /**
   * Get a country location ID by name
   */
  getCountryId(countryName: string): string | null {
    const key = `country:${countryName}`;
    return this.cache.get(key)?.id ?? null;
  }

  /**
   * Get a location by type and name
   */
  async getLocationId(type: string, name: string): Promise<string | null> {
    const key = `${type}:${name}`;
    
    // Check cache first
    const cached = this.cache.get(key);
    if (cached) {
      return cached.id;
    }

    // Not in cache, fetch from database
    const supabase = getSupabase();
    if (!supabase) return null;

    try {
      const { data, error } = await supabase
        .from('locations')
        .select('id, type, name, parent_id, iso_code')
        .eq('type', type)
        .eq('name', name)
        .single();

      if (error) {
        console.error(`Failed to fetch ${type} location '${name}':`, error);
        return null;
      }

      if (data) {
        this.cache.set(key, data);
        return data.id;
      }

      return null;
    } catch (error) {
      console.error(`Error fetching location ${type}:${name}:`, error);
      return null;
    }
  }

  /**
   * Get location IDs for a user based on their profile
   */
  async getUserLocationIds(userId: string): Promise<LocationIds> {
    const supabase = getSupabase();
    if (!supabase || !userId) {
      return {
        global: this.globalLocationId,
        country: null,
        state: null,
        city: null,
      };
    }

    try {
      // Fetch user's location settings
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('city_location_id, state_location_id, country_location_id')
        .eq('user_id', userId)
        .single();

      if (error) {
        console.error('Failed to fetch user profile locations:', error);
        return {
          global: this.globalLocationId,
          country: null,
          state: null,
          city: null,
        };
      }

      return {
        global: this.globalLocationId,
        country: profile?.country_location_id ?? null,
        state: profile?.state_location_id ?? null,
        city: profile?.city_location_id ?? null,
      };
    } catch (error) {
      console.error('Error fetching user location IDs:', error);
      return {
        global: this.globalLocationId,
        country: null,
        state: null,
        city: null,
      };
    }
  }

  /**
   * Clear the cache (useful for testing or forced refresh)
   */
  clear(): void {
    this.cache.clear();
    this.globalLocationId = null;
    this.lastFetch = null;
  }
}

// Singleton instance
export const locationCache = new LocationCache();

/**
 * Service methods for location operations
 */
export const locationService = {
  /**
   * Initialize the location cache
   * Should be called once during app initialization
   */
  async initialize(): Promise<void> {
    return locationCache.initialize();
  },

  /**
   * Get the global location ID
   */
  getGlobalLocationId(): string | null {
    return locationCache.getGlobalId();
  },

  /**
   * Get a country location ID by country name
   */
  getCountryLocationId(countryName: string): string | null {
    return locationCache.getCountryId(countryName);
  },

  /**
   * Get location IDs for the current user
   */
  async getUserLocationIds(userId: string): Promise<LocationIds> {
    return locationCache.getUserLocationIds(userId);
  },

  /**
   * Get a specific location ID by type and name
   */
  async getLocationId(type: string, name: string): Promise<string | null> {
    return locationCache.getLocationId(type, name);
  },

  /**
   * Clear the cache (useful for testing)
   */
  clearCache(): void {
    locationCache.clear();
  },
};
