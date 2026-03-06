-- Add fields to store product image URL and Cloudinary public_id.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS image_url varchar(512);

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS image_public_id varchar(255);

