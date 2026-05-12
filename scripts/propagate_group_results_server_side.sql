DO $$
DECLARE
    result_rec RECORD;
    file_rec RECORD;
    v_content_id UUID;
    metadata_json JSONB;
    text_len INT;
    chunk_size INT := 1500;
    step_size INT := 1350;
    propagated_groups INT := 0;
    propagated_files INT := 0;
BEGIN
    FOR result_rec IN
        SELECT r.group_id,
               r.source_file_id,
               r.converted_path,
               COALESCE(r.processor_name, 'group-propagate') AS processor_name,
               r.text_content,
               g.extension
        FROM document_processing_group_results r
        JOIN document_processing_groups g ON g.id = r.group_id
        WHERE r.extraction_status = 'done'
          AND r.text_content IS NOT NULL
          AND btrim(r.text_content) <> ''
        ORDER BY g.priority, g.extension
    LOOP
        text_len := char_length(result_rec.text_content);
        metadata_json := jsonb_build_object(
            'document_processing_group_id', result_rec.group_id,
            'group_source_file_id', result_rec.source_file_id,
            'converted_path', result_rec.converted_path,
            'propagation', 'sha256_hash+extension'
        );

        FOR file_rec IN
            SELECT file_id
            FROM document_processing_group_files
            WHERE group_id = result_rec.group_id
            ORDER BY is_representative DESC, file_id
        LOOP
            v_content_id := gen_random_uuid();

            DELETE FROM entities WHERE file_id = file_rec.file_id;

            DELETE FROM content_chunks
            WHERE content_chunks.content_id IN (
                SELECT id
                FROM extracted_contents
                WHERE file_id = file_rec.file_id
                  AND email_message_id IS NULL
            );

            DELETE FROM extracted_contents
            WHERE file_id = file_rec.file_id
              AND email_message_id IS NULL;

            DELETE FROM documents
            WHERE file_id = file_rec.file_id;

            DELETE FROM file_derivatives
            WHERE parent_file_id = file_rec.file_id
              AND derivative_type IN (
                  'doc-to-docx',
                  'hwp-to-hwpx',
                  'group-converted-document',
                  'group-native-document'
              );

            INSERT INTO documents(
                id, file_id, doc_type, page_count, sheet_count, processor_name, extracted_at
            ) VALUES (
                gen_random_uuid(),
                file_rec.file_id,
                ltrim(result_rec.extension, '.'),
                1,
                0,
                result_rec.processor_name,
                NOW()
            );

            INSERT INTO extracted_contents(
                id, file_id, email_message_id, content_kind, unit_type, unit_index,
                text_content, language, char_count, confidence,
                processor_name, processor_version, model_name, prompt_version, metadata, created_at
            ) VALUES (
                v_content_id,
                file_rec.file_id,
                NULL,
                'text',
                'document',
                0,
                result_rec.text_content,
                'ko',
                text_len,
                NULL,
                result_rec.processor_name,
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
                   file_rec.file_id,
                   gs.idx,
                   substring(result_rec.text_content FROM (gs.idx * step_size + 1) FOR chunk_size),
                   greatest(1, char_length(substring(result_rec.text_content FROM (gs.idx * step_size + 1) FOR chunk_size)) / 4),
                   gs.idx * step_size,
                   least(gs.idx * step_size + chunk_size, text_len)
            FROM generate_series(0, greatest(0, ceil(text_len::numeric / step_size)::int - 1)) AS gs(idx)
            WHERE substring(result_rec.text_content FROM (gs.idx * step_size + 1) FOR chunk_size) <> '';

            INSERT INTO file_derivatives(
                parent_file_id, child_file_id, derivative_type, ordinal,
                original_name, extracted_path, metadata, created_at
            ) VALUES (
                file_rec.file_id,
                NULL,
                CASE WHEN result_rec.converted_path IS NULL
                     THEN 'group-native-document'
                     ELSE 'group-converted-document'
                END,
                0,
                result_rec.converted_path,
                result_rec.converted_path,
                metadata_json,
                NOW()
            );

            UPDATE files
            SET etl_status = 'done',
                etl_error = NULL,
                etl_processed_at = NOW()
            WHERE id = file_rec.file_id;

            propagated_files := propagated_files + 1;
        END LOOP;

        UPDATE document_processing_groups
        SET status = 'propagated',
            processed_at = NOW()
        WHERE id = result_rec.group_id;

        propagated_groups := propagated_groups + 1;
    END LOOP;

    RAISE NOTICE 'propagated_groups=%, propagated_files=%', propagated_groups, propagated_files;
END $$;
