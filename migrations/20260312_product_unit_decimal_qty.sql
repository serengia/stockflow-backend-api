-- Add unit of measure to products (piece, kg, gram, liter, meter, dozen, box, pack)
ALTER TABLE products ADD COLUMN unit VARCHAR(20) NOT NULL DEFAULT 'piece';

-- Convert quantity columns from INTEGER to NUMERIC(12,3) to support fractional quantities
ALTER TABLE stock_levels ALTER COLUMN quantity TYPE NUMERIC(12,3);
ALTER TABLE sale_items ALTER COLUMN quantity TYPE NUMERIC(12,3);
ALTER TABLE stock_movements ALTER COLUMN quantity TYPE NUMERIC(12,3);
ALTER TABLE return_items ALTER COLUMN quantity TYPE NUMERIC(12,3);
ALTER TABLE stock_transfer_items ALTER COLUMN quantity TYPE NUMERIC(12,3);
