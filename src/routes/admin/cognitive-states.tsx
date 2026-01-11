// src/routes/admin/cognitive-states.tsx
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Brain, RefreshCw, Search, Eye } from 'lucide-react';
import { formatStanceValue, getStanceColor } from '@/hooks/useCognitiveState';
import { getSupabase } from '@/lib/supabaseClient';  // ← CHANGED: Use your project's supabase import

interface CognitiveStateRow {
  id: string;
  user_id: string;
  user_email?: string;
  state_status: 'current' | 'historical' | 'computing';
  total_questions_answered: number;
  active_topic_count: number;
  overall_mean_stance: number;
  overall_median_stance: number;
  stance_consistency_score: number;
  evaluated_at: string;
  created_at: string;
}

export default function AdminCognitiveStatesPage() {
  const [searchEmail, setSearchEmail] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const supabase = getSupabase();  // ← CHANGED: Get supabase instance

  // Fetch all cognitive states
  const { data: cognitiveStates, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-cognitive-states', searchEmail],
    queryFn: async () => {
      if (!supabase) throw new Error('Supabase client not available');

      // Fetch cognitive states
      const { data: states, error: statesError } = await supabase
        .from('user_cognitive_states')
        .select(`
          id,
          user_id,
          state_status,
          total_questions_answered,
          active_topic_count,
          overall_mean_stance,
          overall_median_stance,
          stance_consistency_score,
          evaluated_at,
          created_at
        `)
        .order('created_at', { ascending: false })
        .limit(100);

      if (statesError) {
        console.error('Error fetching cognitive states:', statesError);
        throw statesError;
      }

      console.log('Fetched cognitive states:', states);

      if (!states || states.length === 0) {
        return [];
      }

      // Get user emails separately
      const userIds = [...new Set(states.map(s => s.user_id))];
      
      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('id, email')
        .in('id', userIds);

      if (usersError) {
        console.error('Error fetching users:', usersError);
        // Don't throw - just continue without emails
      }

      console.log('Fetched users:', users);

      const userEmailMap = new Map(users?.map(u => [u.id, u.email]) || []);

      return states.map(state => ({
        ...state,
        user_email: userEmailMap.get(state.user_id) || 'Unknown',
      })) as CognitiveStateRow[];
    },
    staleTime: 30 * 1000,
  });

  // Fetch detailed state for selected user
  const { data: detailedState } = useQuery({
    queryKey: ['admin-cognitive-state-detail', selectedUserId],
    queryFn: async () => {
      if (!selectedUserId || !supabase) return null;

      const { data, error } = await supabase
        .from('user_cognitive_states')
        .select('*')
        .eq('user_id', selectedUserId)
        .eq('state_status', 'current')
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!selectedUserId,
  });

  // Calculate cognitive state for a user
  const handleCalculateState = async (userId: string) => {
    if (!supabase) {
      alert('Supabase client not available');
      return;
    }

    try {
      const { data, error } = await supabase.rpc('calculate_cognitive_state', {
        p_user_id: userId,
      });

      if (error) throw error;

      alert('Cognitive state calculated successfully!');
      refetch();
    } catch (err: any) {
      console.error('Error calculating state:', err);
      alert(`Error: ${err.message}`);
    }
  };

  const filteredStates = cognitiveStates?.filter(state => 
    !searchEmail || state.user_email?.toLowerCase().includes(searchEmail.toLowerCase())
  );

  // Debug logs
  React.useEffect(() => {
    console.log('Component state:', {
      isLoading,
      error,
      cognitiveStatesCount: cognitiveStates?.length,
      filteredStatesCount: filteredStates?.length,
    });
  }, [isLoading, error, cognitiveStates, filteredStates]);

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Brain className="h-8 w-8" />
            Cognitive States
          </h1>
          <p className="text-muted-foreground mt-1">
            View and manage user cognitive profiles
          </p>
        </div>
        <Button onClick={() => refetch()} variant="outline">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total States
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{cognitiveStates?.length || 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Current States
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {cognitiveStates?.filter(s => s.state_status === 'current').length || 0}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg Questions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {cognitiveStates && cognitiveStates.length > 0
                ? (cognitiveStates.reduce((sum, s) => sum + s.total_questions_answered, 0) / cognitiveStates.length).toFixed(0)
                : 0}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg Topics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {cognitiveStates && cognitiveStates.length > 0
                ? (cognitiveStates.reduce((sum, s) => sum + s.active_topic_count, 0) / cognitiveStates.length).toFixed(1)
                : 0}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Debug Info */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            Error loading cognitive states: {error.message}
            <br />
            <code className="text-xs">{JSON.stringify(error)}</code>
          </AlertDescription>
        </Alert>
      )}

      {/* Search */}
      <Card>
        <CardHeader>
          <CardTitle>Search Cognitive States</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by email..."
                value={searchEmail}
                onChange={(e) => setSearchEmail(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cognitive States Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Cognitive States</CardTitle>
          <CardDescription>
            {filteredStates?.length || 0} states found
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : error ? (
            <Alert variant="destructive">
              <AlertDescription>
                Error loading cognitive states: {error.message}
              </AlertDescription>
            </Alert>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Questions</TableHead>
                    <TableHead className="text-right">Topics</TableHead>
                    <TableHead className="text-right">Mean Stance</TableHead>
                    <TableHead className="text-right">Consistency</TableHead>
                    <TableHead className="text-right">Evaluated</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredStates?.map((state) => (
                    <TableRow key={state.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm">{state.user_email || 'Unknown'}</p>
                          <p className="text-xs text-muted-foreground font-mono">
                            {state.user_id.slice(0, 8)}...
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={state.state_status === 'current' ? 'default' : 'secondary'}>
                          {state.state_status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {state.total_questions_answered}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {state.active_topic_count}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={`font-bold ${getStanceColor(state.overall_mean_stance)}`}>
                          {state.overall_mean_stance.toFixed(2)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {(state.stance_consistency_score * 100).toFixed(0)}%
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {new Date(state.evaluated_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 justify-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setSelectedUserId(state.user_id)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleCalculateState(state.user_id)}
                          >
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {filteredStates?.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  No cognitive states found
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail View Modal/Card */}
      {selectedUserId && detailedState && (
        <Card className="border-2 border-primary">
          <CardHeader>
            <div className="flex justify-between items-start">
              <div>
                <CardTitle>Detailed Cognitive Profile</CardTitle>
                <CardDescription>
                  User ID: {selectedUserId.slice(0, 8)}...
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelectedUserId(null)}>
                Close
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-xs">
              {JSON.stringify(detailedState.cognitive_profile, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
