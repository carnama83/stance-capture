/**
 * Epic C - Search Page Component
 * Full-text search across all questions
 */

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Search, Loader2, MessageSquare } from 'lucide-react';
import { Link } from 'react-router-dom';
import { STATE_LABELS, formatTimeAgo, type SearchResult } from '@/types/feedTypes';
import { useTranslation } from "react-i18next";

export function SearchPage() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  
  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);
    
    return () => clearTimeout(timer);
  }, [query]);
  
  // Perform search
  const { data: results, isLoading } = useQuery<SearchResult[]>({
    queryKey: ['search-questions', debouncedQuery],
    queryFn: async () => {
      if (!debouncedQuery || debouncedQuery.length < 2) return [];
      
      const { data, error } = await supabase.rpc('search_questions', {
        p_query: debouncedQuery,
        p_user_id: null,
        p_limit: 20,
        p_offset: 0,
      });
      
      if (error) throw error;
      return data as SearchResult[];
    },
    enabled: debouncedQuery.length >= 2,
  });
  
  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <h1 className="text-3xl font-bold mb-6">{t("search.searchQuestions")}</h1>
      
      {/* Search Input */}
      <div className="relative mb-8">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
        <Input
          type="text"
          placeholder={t("search.searchQuestions2")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-10 text-lg py-6"
          autoFocus
        />
        {isLoading && (
          <Loader2 className="absolute right-3 top-1/2 transform -translate-y-1/2 h-5 w-5 animate-spin text-gray-400" />
        )}
      </div>
      
      {/* Results Count */}
      {!isLoading && results && results.length > 0 && (
        <p className="text-sm text-gray-600 mb-4">
          {t("search.foundResults", { count: results.length, q: debouncedQuery })}
        </p>
      )}
      
      {/* Results */}
      {!isLoading && results && results.length > 0 && (
        <div className="space-y-4">
          {results.map((result) => (
            <SearchResultCard key={result.question_id} result={result} />
          ))}
        </div>
      )}
      
      {/* No Results */}
      {!isLoading && debouncedQuery.length >= 2 && (!results || results.length === 0) && (
        <Card className="p-8 text-center">
          <p className="text-gray-600 mb-2">
            {t("search.noResultsFor", { q: debouncedQuery })}
          </p>
          <p className="text-sm text-gray-500">
            {t("search.tryDifferentKeywordsOrBrowse")}
          </p>
        </Card>
      )}
      
      {/* Empty State */}
      {query.length === 0 && (
        <Card className="p-12 text-center">
          <Search className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-700 mb-2">
            {t("search.searchForQuestions")}
          </h2>
          <p className="text-gray-500">
            {t("search.startTypingToSearchAcross")}
          </p>
        </Card>
      )}
      
      {/* Min Characters */}
      {query.length > 0 && query.length < 2 && (
        <Card className="p-8 text-center">
          <p className="text-gray-600">
            {t("search.typeAtLeast2Characters")}
          </p>
        </Card>
      )}
    </div>
  );
}

function SearchResultCard({ result }: { result: SearchResult }) {
  const { t } = useTranslation();
  const stateConfig = STATE_LABELS[result.state as keyof typeof STATE_LABELS];
  
  return (
    <Link to={`/q/${result.question_id}`}>
      <Card className="p-6 hover:shadow-lg transition-all duration-200 cursor-pointer bg-white">
        <div className="flex items-start gap-4">
          <div className="flex-1 min-w-0">
            {/* Topic */}
            <div className="text-sm text-gray-600 mb-1 flex items-center gap-2">
              <span>📁 {result.topic_title}</span>
              {stateConfig && (
                <span className={`px-2 py-0.5 text-xs rounded border ${stateConfig.color}`}>
                  {t(stateConfig.labelKey)}
                </span>
              )}
            </div>
            
            {/* Question */}
            <h3 className="text-lg font-semibold mb-2 hover:text-blue-600 transition-colors">
              {result.question}
            </h3>
            
            {/* Summary */}
            {result.summary && (
              <p className="text-sm text-gray-700 mb-3 line-clamp-2">
                {result.summary}
              </p>
            )}
            
            {/* Footer */}
            <div className="flex items-center gap-4 text-sm text-gray-600">
              <span className="flex items-center gap-1">
                <MessageSquare className="h-4 w-4" />
                {t("search.stancesRecordedCount", { count: result.response_count })}
              </span>
              
              <span>
                {formatTimeAgo(result.published_at)}
              </span>
              
              {result.tags && result.tags.length > 0 && (
                <div className="flex gap-1 ml-auto">
                  {result.tags.slice(0, 2).map((tag) => (
                    <span key={tag} className="bg-gray-100 px-2 py-0.5 rounded text-xs">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}
