// routes/admin/cron-jobs/Index.tsx
// Admin page for managing cron jobs

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import { 
  Play, 
  Pause, 
  Trash2, 
  RefreshCw, 
  Clock, 
  CheckCircle, 
  XCircle,
  AlertCircle,
  Plus,
  Edit,
  Activity
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

interface CronJob {
  jobid: number;
  schedule: string;
  command: string;
  nodename: string;
  nodeport: number;
  database: string;
  username: string;
  active: boolean;
  jobname: string;
}

interface JobHistory {
  jobid: number;
  runid: number;
  job_pid: number;
  database: string;
  username: string;
  command: string;
  status: string;
  return_message: string;
  start_time: string;
  end_time: string;
  duration: string;
}

interface JobStats {
  jobid: number;
  total_runs: number;
  successful_runs: number;
  failed_runs: number;
  avg_duration_seconds: number;
  last_run_time: string;
  last_run_status: string;
}

export default function AdminCronJobsPage() {
  const supabase = React.useMemo(getSupabase, []);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [selectedJob, setSelectedJob] = React.useState<CronJob | null>(null);
  const [showHistory, setShowHistory] = React.useState(false);
  const [showCreateDialog, setShowCreateDialog] = React.useState(false);
  const [showEditDialog, setShowEditDialog] = React.useState(false);

  // Fetch all cron jobs
  const { data: jobs, isLoading } = useQuery<CronJob[]>({
    queryKey: ['cron-jobs'],
    queryFn: async () => {
      if (!supabase) throw new Error('Supabase not initialized');
      const { data, error } = await supabase.rpc('get_all_cron_jobs');
      if (error) throw error;
      return data as CronJob[];
    },
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  // Fetch job history for selected job
  const { data: history } = useQuery<JobHistory[]>({
    queryKey: ['cron-history', selectedJob?.jobid],
    queryFn: async () => {
      if (!supabase || !selectedJob) return [];
      const { data, error } = await supabase.rpc('get_cron_job_history', {
        p_jobid: selectedJob.jobid,
        p_limit: 20
      });
      if (error) throw error;
      return data as JobHistory[];
    },
    enabled: !!selectedJob && showHistory,
  });

  // Fetch job stats
  const { data: stats } = useQuery<JobStats[]>({
    queryKey: ['cron-stats'],
    queryFn: async () => {
      if (!supabase || !jobs) return [];
      const statsPromises = jobs.map(job =>
        supabase.rpc('get_cron_job_stats', { p_jobid: job.jobid })
      );
      const results = await Promise.all(statsPromises);
      return results.map(r => r.data?.[0]).filter(Boolean) as JobStats[];
    },
    enabled: !!jobs && jobs.length > 0,
  });

  // Toggle job (pause/resume)
  const toggleMutation = useMutation({
    mutationFn: async (jobid: number) => {
      if (!supabase) throw new Error('Supabase not initialized');
      const { data, error } = await supabase.rpc('toggle_cron_job', {
        p_jobid: jobid
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['cron-jobs'] });
      toast({
        title: "Success",
        description: data[0]?.message || "Job toggled successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Trigger job now
  const triggerMutation = useMutation({
    mutationFn: async (jobid: number) => {
      if (!supabase) throw new Error('Supabase not initialized');
      const { data, error } = await supabase.rpc('trigger_cron_job_now', {
        p_jobid: jobid
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Job executed successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['cron-history'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Delete job
  const deleteMutation = useMutation({
    mutationFn: async (jobid: number) => {
      if (!supabase) throw new Error('Supabase not initialized');
      const { data, error } = await supabase.rpc('delete_cron_job', {
        p_jobid: jobid
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cron-jobs'] });
      toast({
        title: "Success",
        description: "Job deleted successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Update schedule
  const updateScheduleMutation = useMutation({
    mutationFn: async ({ jobid, schedule }: { jobid: number; schedule: string }) => {
      if (!supabase) throw new Error('Supabase not initialized');
      const { data, error } = await supabase.rpc('update_cron_schedule', {
        p_jobid: jobid,
        p_new_schedule: schedule
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cron-jobs'] });
      setShowEditDialog(false);
      toast({
        title: "Success",
        description: "Schedule updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Create new job
  const createMutation = useMutation({
    mutationFn: async ({ jobname, schedule, command }: { jobname: string; schedule: string; command: string }) => {
      if (!supabase) throw new Error('Supabase not initialized');
      const { data, error } = await supabase.rpc('create_cron_job', {
        p_jobname: jobname,
        p_schedule: schedule,
        p_command: command
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cron-jobs'] });
      setShowCreateDialog(false);
      toast({
        title: "Success",
        description: "Job created successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const getJobStats = (jobid: number) => {
    return stats?.find(s => s.jobid === jobid);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-slate-400" />
          <p className="text-slate-600">Loading cron jobs...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Cron Jobs</h1>
          <p className="text-slate-600 mt-1">
            Manage scheduled background tasks
          </p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className="w-4 h-4 mr-2" />
          New Job
        </Button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-slate-600">
              Total Jobs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{jobs?.length || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-slate-600">
              Active
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {jobs?.filter(j => j.active).length || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-slate-600">
              Paused
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">
              {jobs?.filter(j => !j.active).length || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-slate-600">
              Success Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {stats && stats.length > 0
                ? Math.round(
                    (stats.reduce((acc, s) => acc + s.successful_runs, 0) /
                      stats.reduce((acc, s) => acc + s.total_runs, 0)) *
                      100
                  )
                : 0}
              %
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Jobs List */}
      <div className="space-y-4">
        {jobs?.map((job) => {
          const jobStats = getJobStats(job.jobid);
          return (
            <JobCard
              key={job.jobid}
              job={job}
              stats={jobStats}
              onToggle={() => toggleMutation.mutate(job.jobid)}
              onTrigger={() => triggerMutation.mutate(job.jobid)}
              onDelete={() => {
                if (confirm('Are you sure you want to delete this job?')) {
                  deleteMutation.mutate(job.jobid);
                }
              }}
              onEdit={() => {
                setSelectedJob(job);
                setShowEditDialog(true);
              }}
              onViewHistory={() => {
                setSelectedJob(job);
                setShowHistory(true);
              }}
            />
          );
        })}
      </div>

      {/* Dialogs */}
      <CreateJobDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onCreate={createMutation.mutate}
        isLoading={createMutation.isPending}
      />

      <EditScheduleDialog
        open={showEditDialog}
        job={selectedJob}
        onClose={() => setShowEditDialog(false)}
        onUpdate={updateScheduleMutation.mutate}
        isLoading={updateScheduleMutation.isPending}
      />

      <JobHistoryDialog
        open={showHistory}
        job={selectedJob}
        history={history}
        onClose={() => setShowHistory(false)}
      />
    </div>
  );
}

// Job Card Component
function JobCard({ job, stats, onToggle, onTrigger, onDelete, onEdit, onViewHistory }: {
  job: CronJob;
  stats?: JobStats;
  onToggle: () => void;
  onTrigger: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onViewHistory: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="space-y-1 flex-1">
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg">{job.jobname}</CardTitle>
              {job.active ? (
                <Badge variant="default" className="bg-green-500">
                  <Activity className="w-3 h-3 mr-1" />
                  Active
                </Badge>
              ) : (
                <Badge variant="secondary">
                  <Pause className="w-3 h-3 mr-1" />
                  Paused
                </Badge>
              )}
            </div>
            <CardDescription className="flex items-center gap-4 text-sm">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {job.schedule}
              </span>
              {stats && (
                <>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <CheckCircle className="w-3 h-3 text-green-500" />
                    {stats.successful_runs}/{stats.total_runs} runs
                  </span>
                  {stats.failed_runs > 0 && (
                    <>
                      <span>•</span>
                      <span className="flex items-center gap-1 text-red-500">
                        <XCircle className="w-3 h-3" />
                        {stats.failed_runs} failed
                      </span>
                    </>
                  )}
                </>
              )}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={onToggle}
              title={job.active ? "Pause job" : "Resume job"}
            >
              {job.active ? (
                <Pause className="w-4 h-4" />
              ) : (
                <Play className="w-4 h-4" />
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onTrigger}
              title="Run now"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onEdit}
              title="Edit schedule"
            >
              <Edit className="w-4 h-4" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onDelete}
              title="Delete job"
              className="text-red-600 hover:text-red-700"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div>
            <p className="text-sm font-medium text-slate-700">Command:</p>
            <code className="block mt-1 p-2 bg-slate-50 rounded text-xs font-mono text-slate-800">
              {job.command}
            </code>
          </div>
          {stats && (
            <div className="flex items-center justify-between text-sm text-slate-600 pt-2 border-t">
              <span>
                Last run: {stats.last_run_time ? new Date(stats.last_run_time).toLocaleString() : 'Never'}
              </span>
              <Button variant="link" size="sm" onClick={onViewHistory}>
                View History →
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// Create Job Dialog
function CreateJobDialog({ open, onClose, onCreate, isLoading }: {
  open: boolean;
  onClose: () => void;
  onCreate: (data: { jobname: string; schedule: string; command: string }) => void;
  isLoading: boolean;
}) {
  const [jobname, setJobname] = React.useState('');
  const [schedule, setSchedule] = React.useState('');
  const [command, setCommand] = React.useState('');

  const handleSubmit = () => {
    onCreate({ jobname, schedule, command });
    setJobname('');
    setSchedule('');
    setCommand('');
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Cron Job</DialogTitle>
          <DialogDescription>
            Schedule a new background task
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <Label htmlFor="jobname">Job Name</Label>
            <Input
              id="jobname"
              value={jobname}
              onChange={(e) => setJobname(e.target.value)}
              placeholder="my-job-name"
            />
          </div>
          <div>
            <Label htmlFor="schedule">Schedule (Cron Format)</Label>
            <Input
              id="schedule"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              placeholder="*/15 * * * *"
            />
            <p className="text-xs text-slate-500 mt-1">
              Example: */15 * * * * = Every 15 minutes
            </p>
          </div>
          <div>
            <Label htmlFor="command">SQL Command</Label>
            <Textarea
              id="command"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="SELECT my_function();"
              rows={4}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isLoading || !jobname || !schedule || !command}>
            {isLoading ? "Creating..." : "Create Job"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Edit Schedule Dialog
function EditScheduleDialog({ open, job, onClose, onUpdate, isLoading }: {
  open: boolean;
  job: CronJob | null;
  onClose: () => void;
  onUpdate: (data: { jobid: number; schedule: string }) => void;
  isLoading: boolean;
}) {
  const [schedule, setSchedule] = React.useState('');

  React.useEffect(() => {
    if (job) {
      setSchedule(job.schedule);
    }
  }, [job]);

  const handleSubmit = () => {
    if (job) {
      onUpdate({ jobid: job.jobid, schedule });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Schedule</DialogTitle>
          <DialogDescription>
            Update the cron schedule for {job?.jobname}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <Label htmlFor="edit-schedule">Schedule (Cron Format)</Label>
            <Input
              id="edit-schedule"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              placeholder="*/15 * * * *"
            />
            <p className="text-xs text-slate-500 mt-1">
              Current: {job?.schedule}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isLoading || !schedule}>
            {isLoading ? "Updating..." : "Update"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Job History Dialog
function JobHistoryDialog({ open, job, history, onClose }: {
  open: boolean;
  job: CronJob | null;
  history?: JobHistory[];
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Job History - {job?.jobname}</DialogTitle>
          <DialogDescription>
            Recent execution history
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {history && history.length > 0 ? (
            history.map((run) => (
              <div
                key={run.runid}
                className="p-3 border rounded-lg space-y-1"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {run.status === 'succeeded' ? (
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-500" />
                    )}
                    <span className="font-medium text-sm">
                      Run #{run.runid}
                    </span>
                    <Badge variant={run.status === 'succeeded' ? 'default' : 'destructive'}>
                      {run.status}
                    </Badge>
                  </div>
                  <span className="text-xs text-slate-500">
                    {new Date(run.start_time).toLocaleString()}
                  </span>
                </div>
                {run.return_message && (
                  <p className="text-xs text-slate-600 pl-6">
                    {run.return_message}
                  </p>
                )}
                <div className="flex items-center gap-4 text-xs text-slate-500 pl-6">
                  <span>Duration: {run.duration}</span>
                  <span>PID: {run.job_pid}</span>
                </div>
              </div>
            ))
          ) : (
            <p className="text-center text-slate-500 py-8">
              No execution history yet
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
