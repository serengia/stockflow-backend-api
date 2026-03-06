-- Store Cloudinary public_id for user avatar (used when deleting or replacing).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_public_id varchar(255);
