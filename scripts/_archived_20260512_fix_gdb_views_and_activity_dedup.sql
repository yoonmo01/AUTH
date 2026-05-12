-- v_gdb_edges_mentions: amount 엔터티 제외 (GraphDB 노이즈 감소)
CREATE OR REPLACE VIEW v_gdb_edges_mentions AS
SELECT
    'mention:'::text || e.id::text AS edge_id,
    'file'::text AS source_type,
    'file:'::text || e.file_id::text AS source_id,
    ec.entity_type::text AS target_type,
    'entity:'::text || ec.id::text AS target_id,
    'MENTIONS'::text AS relation_type,
    (f.filename || ' -> '::text) || ec.canonical_value AS label,
    e.confidence
FROM entities e
JOIN files f ON f.id = e.file_id
JOIN entity_canonical ec ON ec.id = e.canonical_entity_id
WHERE e.canonical_entity_id IS NOT NULL
  AND ec.entity_type::text != 'amount';

-- activity_events 중복 제거 (같은 파일에서 같은 이벤트+액터+제목 중복)
DELETE FROM activity_events
WHERE id NOT IN (
    SELECT DISTINCT ON (event_type, actor, title, source_file_id) id
    FROM activity_events
    ORDER BY event_type, actor, title, source_file_id, created_at
);

-- 노이즈 엔터티 제거 (이메일 주소, 파일명, 무관 인물)
DELETE FROM entities WHERE canonical_entity_id IN (
    SELECT id FROM entity_canonical WHERE
        entity_type = 'person' AND (
            canonical_value ~* '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
            OR canonical_value ~* '\.(pst|txt|hwp|xls|pdf|doc|xlsx)$'
        )
        OR entity_type = 'organization' AND (
            canonical_value ~* '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
            OR canonical_value ~* '\.(pst|txt|hwp|xls|pdf|doc|xlsx)$'
            OR canonical_value = 'HYENA CTF'
        )
);

-- 고아 canonical 엔터티 정리
DELETE FROM entity_canonical
WHERE id NOT IN (
    SELECT DISTINCT canonical_entity_id FROM entities WHERE canonical_entity_id IS NOT NULL
);
