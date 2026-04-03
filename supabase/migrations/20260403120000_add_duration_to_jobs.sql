-- Wall-clock job time in milliseconds (from started_at when job reaches terminal status).
-- Written by scraper-3 storage.UpdateJobStatus on done/failed.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS duration bigint;

COMMENT ON COLUMN public.jobs.duration IS 'Milliseconds from started_at to completion (done or failed); set by worker on terminal update.';
