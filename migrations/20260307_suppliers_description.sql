-- Add optional description (what they supply) to suppliers.
ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS description varchar(500);
