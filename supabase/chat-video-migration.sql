-- Social Cyrus: enable video attachments in direct messages.
-- Run this as a NEW migration after chat-media-migration.sql.
-- Existing chat-media policies and data are preserved.

update storage.buckets
set file_size_limit = 52428800
where id = 'chat-media';

-- No media_type constraint is added: existing image, file and audio messages remain valid.
-- Video MIME types are validated in the client and stored with their original content type.
