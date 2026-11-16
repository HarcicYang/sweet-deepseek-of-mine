CREATE TABLE skill_files (
  user_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  path TEXT NOT NULL,
  media_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  content TEXT NOT NULL,
  PRIMARY KEY (skill_id, path)
);

CREATE INDEX skill_files_user_skill ON skill_files (user_id, skill_id);

INSERT INTO skill_files (user_id, skill_id, path, media_type, size_bytes, content)
SELECT
  user_id,
  id,
  'SKILL.md',
  'text/markdown',
  length(CAST(source AS BLOB)),
  source
FROM skills;
