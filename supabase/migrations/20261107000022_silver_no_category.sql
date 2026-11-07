-- Silver now means "no category" in the calendar, so categories and habits
-- that were silver move to sky blue.
update public.task_lists set color = '#8FD3FF' where upper(color) = '#E5E5EA';
update public.habits set color = '#8FD3FF' where upper(color) = '#E5E5EA';
