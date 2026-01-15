import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { QuestionCard } from '@/components/feed/QuestionCard';
import { Search, Filter } from 'lucide-react';

export function SearchPage() {
  const [query, setQuery] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState({});

  const { data: results, isLoading } = useQuery({
    queryKey: ['search', searchTerm, filters],
    queryFn: async () => {
      if (!searchTerm) return [];
      
      const { data, error } = await supabase.rpc('search_questions', {
        p_query: searchTerm,
        p_filters: filters,
        p_limit: 50,
      });

      if (error) throw error;
      return data;
    },
    enabled: !!searchTerm,
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchTerm(query);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <form onSubmit={handleSearch} className="mb-8">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
            <Input
              type="text"
              placeholder="Search questions and topics..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Button type="submit">Search</Button>
          <Button type="button" variant="outline">
            <Filter className="h-4 w-4" />
          </Button>
        </div>
      </form>

      {isLoading && <div>Searching...</div>}

      {results && results.length > 0 && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Found {results.length} results
          </p>
          {results.map((question: any) => (
            <QuestionCard
              key={question.question_id}
              question={question}
              showTopicTitle={true}
            />
          ))}
        </div>
      )}

      {searchTerm && results?.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-600">No results found for "{searchTerm}"</p>
        </div>
      )}
    </div>
  );
}
