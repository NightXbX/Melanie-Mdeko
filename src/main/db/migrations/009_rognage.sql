-- Image rognée : une nouvelle image, qui garde la trace de l'image d'origine (jamais modifiée) et du cadre choisi,
-- pour pouvoir rogner à nouveau ou revenir à l'image entière.
ALTER TABLE images ADD COLUMN crop_of INTEGER REFERENCES images(id);
ALTER TABLE images ADD COLUMN crop TEXT; -- {"x":…,"y":…,"w":…,"h":…}, de 0 à 1 sur l'image d'origine
CREATE INDEX images_crop_of ON images (crop_of);
