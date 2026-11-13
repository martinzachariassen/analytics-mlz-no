-- Whether the site accepts GET /api/pixel.gif. A pixel request carries no Origin, so the
-- domain check that guards POST /api/event cannot apply; sites opt in instead.
ALTER TABLE sites ADD COLUMN pixel_enabled INTEGER NOT NULL DEFAULT 0;
