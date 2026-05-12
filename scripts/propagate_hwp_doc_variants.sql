DO $$
DECLARE
    pair_rec RECORD;
    content_rec RECORD;
    v_content_id UUID;
    text_len INT;
    chunk_size INT := 1500;
    step_size INT := 1350;
    metadata_json JSONB;
    propagated INT := 0;
BEGIN
    FOR pair_rec IN
        WITH candidates AS (
            SELECT
                h.id AS hwp_file_id,
                d.id AS doc_file_id,
                h.original_path AS hwp_path,
                d.original_path AS doc_path,
                row_number() OVER (
                    PARTITION BY h.id
                    ORDER BY
                        CASE WHEN d.etl_status='done' THEN 0 ELSE 1 END,
                        d.file_size DESC NULLS LAST,
                        d.id
                ) AS rn
            FROM files h
            JOIN files d
              ON d.category='document'
             AND d.extension='.doc'
             AND regexp_replace(d.original_path, '\\[^\\]*$', '') =
                 regexp_replace(h.original_path, '\\[^\\]*$', '')
            WHERE h.category='document'
              AND h.extension='.hwp'
              AND h.etl_status IN ('skipped','pending','failed')
        )
        SELECT *
        FROM candidates
        WHERE rn=1
    LOOP
        SELECT ec.*
        INTO content_rec
        FROM extracted_contents ec
        WHERE ec.file_id = pair_rec.doc_file_id
          AND ec.email_message_id IS NULL
          AND ec.text_content IS NOT NULL
          AND btrim(ec.text_content) <> ''
        ORDER BY ec.created_at DESC
        LIMIT 1;

        IF NOT FOUND THEN
            CONTINUE;
        END IF;

        text_len := char_length(content_rec.text_content);
        metadata_json := jsonb_build_object(
            'surrogate_source', 'same_folder_doc',
            'reason', 'hwp_doc_format_variant',
            'source_doc_file_id', pair_rec.doc_file_id,
            'source_doc_path', pair_rec.doc_path,
            'target_hwp_path', pair_rec.hwp_path
        );

        DELETE FROM entities WHERE file_id = pair_rec.hwp_file_id;

        DELETE FROM content_chunks
        WHERE content_id IN (
            SELECT id FROM extracted_contents
            WHERE file_id = pair_rec.hwp_file_id
              AND email_message_id IS NULL
        );

        DELETE FROM extracted_contents
        WHERE file_id = pair_rec.hwp_file_id
          AND email_message_id IS NULL;

        DELETE FROM documents
        WHERE file_id = pair_rec.hwp_file_id;

        v_content_id := gen_random_uuid();

        INSERT INTO documents(
            id, file_id, doc_type, page_count, sheet_count, processor_name, extracted_at
        ) VALUES (
            gen_random_uuid(),
            pair_rec.hwp_file_id,
            'hwp',
            1,
            0,
            'same-folder-doc-format-variant',
            NOW()
        );

        INSERT INTO extracted_contents(
            id, file_id, email_message_id, content_kind, unit_type, unit_index,
            text_content, language, char_count, confidence,
            processor_name, processor_version, model_name, prompt_version, metadata, created_at
        ) VALUES (
            v_content_id,
            pair_rec.hwp_file_id,
            NULL,
            'text',
            'document',
            0,
            content_rec.text_content,
            content_rec.language,
            text_len,
            NULL,
            'same-folder-doc-format-variant',
            NULL,
            NULL,
            NULL,
            metadata_json,
            NOW()
        );

        INSERT INTO content_chunks(
            id, content_id, file_id, chunk_index, chunk_text,
            token_count, char_start, char_end
        )
        SELECT gen_random_uuid(),
               v_content_id,
               pair_rec.hwp_file_id,
               gs.idx,
               substring(content_rec.text_content FROM (gs.idx * step_size + 1) FOR chunk_size),
               greatest(1, char_length(substring(content_rec.text_content FROM (gs.idx * step_size + 1) FOR chunk_size)) / 4),
               gs.idx * step_size,
               least(gs.idx * step_size + chunk_size, text_len)
        FROM generate_series(0, greatest(0, ceil(text_len::numeric / step_size)::int - 1)) AS gs(idx)
        WHERE substring(content_rec.text_content FROM (gs.idx * step_size + 1) FOR chunk_size) <> '';

        UPDATE files
        SET etl_status='done',
            etl_error=NULL,
            etl_processed_at=NOW()
        WHERE id=pair_rec.hwp_file_id;

        INSERT INTO file_relations(
            source_file_id, target_file_id, relation_type, confidence, metadata, created_at
        ) VALUES (
            pair_rec.hwp_file_id,
            pair_rec.doc_file_id,
            'format_variant',
            0.85,
            metadata_json,
            NOW()
        ) ON CONFLICT DO NOTHING;

        propagated := propagated + 1;
    END LOOP;

    RAISE NOTICE 'hwp_doc_format_variant_propagated=%', propagated;
END $$;
