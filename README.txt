Domain purpose (what this DB is for)

The database models assistive devices, medical equipment, subsidies, prescriptions, providers, and eligibility rules in the Czech healthcare / social-support context.

Primary use cases:

Determine eligibility for subsidies / insurance coverage

Determine who can prescribe what

Determine who provides / rents / sells equipment

Determine conditions, frequency, exclusions, risks

Support fuzzy user input via documents + vector search

Enforce hard rules via graph relationships

This is not a search-only DB.
It is a rules + relationships DB, with text layered on top.

2. Core node types (authoritative entities)
Equipment

Represents a medical or assistive device category.

Key properties:

name

category (sometimes)

circulation

general_approval_required

general_doba_uziti

general_approval_by

general_approval_exceptions

Examples:

Electric wheelchair

Seat cushion

Walker

Medical device categories

EquipmentVariant

Concrete variants of an equipment type.

Key properties:

variant_name

coverage_czk_without_dph

coverage_percentage

doba_uziti

approval_required

circulation

special_note

search_text

Variants are used to answer:

“How often?”

“How much is covered?”

“Is approval required?”

Organization / Company / Foundation

Entities that provide, rent, sell, or support equipment or services.

Key properties:

name

location

is_rental

source

description

Used to answer:

Who provides / rents / supports X?

What organizations operate in Y?

City / Location / Region

Geographic entities.

Used to answer:

Availability by city / region

Provider location

DoctorSpecialization / MedicalSpecialty / Specialty

Medical roles that can prescribe equipment.

Key properties:

name

code (for DoctorSpecialization)

Used to answer:

Who can prescribe X?

Which specialization is required?

Risk / Condition / Status / Frequency / Cost / Quantity

Constraint and rule nodes.

Used to model:

Risks

Eligibility conditions

Coverage limits

Frequency rules

3. Knowledge / text layer (discovery, fuzziness)
Document

Authoritative text source (law, guideline, article).

Key properties:

human_name

url

source

title

Chunk

Vector-indexed text fragments from Documents.

Key properties:

text

embedding

word_count

source_name

Purpose:

Handle fuzzy input

Resolve vague or poorly written questions

Identify which subsidy / law / device is being discussed

4. Conceptual / semantic nodes
Topic / Concept / Entity

Abstract semantic anchors.

Used to:

Link documents to equipment, laws, services

Normalize different names / synonyms

Enable semantic traversal after vector search

These are not authoritative by themselves; they help connect text to rules.

5. Key relationship types (this is the “logic”)
Prescription & eligibility

CAN_BE_PRESCRIBED_BY

IS_PRESCRIBED_BY

FOR_SPECIALIZATION

REQUIRES_APPROVAL_BY

REQUIRES_INSURANCE_APPROVAL

HAS_CONDITION

HAS_RISK

FOLLOWS_GUIDELINE

Provision & availability

PROVIDES

OFFERS

RENTS_PRODUCT_FOR

SELLS

CAN_BE_PROVIDED_TO

OWNED_BY

Structure & classification

HAS_VARIANT

IS_A

IS_TYPE_OF

IS_A_SUBTYPE_OF

IS_A_CATEGORY

PART_OF

INCLUDES

APPLIES_TO

Geography

LOCATED_IN

HAS_LOCATION

Documentation

EXPLAINS_TOPIC

ABOUT

CONCERNS

LAST_UPDATED

6. How answers are supposed to be derived
Step 1 — Meaning resolution (TEXT / vector)

Use Chunk vector search to determine:

Which equipment

Which subsidy / law

Which topic

This handles:

Typos

Lay language

Cognitive / linguistic impairment

Step 2 — Rule enforcement (GRAPH)

Once the target entity is known:

Traverse relationships to answer:

eligibility

frequency

who can prescribe

who provides

exclusions / risks

The graph is the source of truth.
Text alone is insufficient.

7. What “correct answers” look like

A correct answer:

Is grounded in Document text

Is constrained by graph relationships

Does not invent providers, eligibility, or rules

Can say “not possible / not covered” explicitly

8. What complex tests should verify

An AI testing this system should be able to test:

Eligibility resolution

Input: vague subsidy question

Output: conditions + yes/no + why

Prescription logic

Equipment → specialization → provider

Frequency rules

EquipmentVariant → doba_uziti

Geographic availability

Equipment → Organization → City

Fallback correctness

When graph has no match, answer from documents only

No hallucination

If graph lacks a relationship, system must say so

9. One-sentence summary for another AI

This Neo4j database models assistive equipment and subsidies where documents discover meaning, the graph enforces eligibility and rules, and answers must be derived from explicit relationships, not inferred text.



================================================



Formal schema spec (grounded in your dumps)
Labels and observed properties

Equipment

id (sometimes)

name

category (sometimes)

circulation (sometimes)

general_doba_uziti (sometimes)

general_approval_required (sometimes)

general_approval_by (sometimes)

general_approval_exceptions (sometimes)

EquipmentVariant

id

variant_name

search_text

circulation (sometimes)

coverage_czk_without_dph (sometimes)

coverage_percentage (sometimes)

coverage_note (sometimes)

doba_uziti (sometimes)

approval_required (sometimes)

special_note (sometimes)

Organization

id (sometimes)

name (sometimes)

source (sometimes)

description (sometimes)

location (sometimes)

is_rental (sometimes)

Company

id (sometimes)

name (sometimes)

source (sometimes)

location (sometimes)

Foundation

id

name (sometimes)

source (sometimes)

description (sometimes)

Rental

name

source

city

products

City

id (sometimes)

name (sometimes)

Location / Region / Category / Object / Group / Item / Service / Component / Law / Date / Status / Risk / Cost / Quantity / Frequency / Profession / Specialization / Specialty / Medical specialty / Medicalspecialty / Medical device category / Medical device type / Device / Device_type / Equipmenttype / Walker / Accessory / Electric wheelchair / Wheelchair type / Person / Support area / Area of support / Product category / Support_Area

id (observed for all of these; no other properties in your dump)

DoctorSpecialization

name

code

Document
Two observed “shapes” in your dump:

Knowledge ingestion shape: id:ID, label, word_count:int, embedding, text, page_content, content, source_name

Source doc shape: name, url, source, human_name
Also: title, id (observed)

Chunk

id:ID, label, word_count:int, embedding, text, page_content, content, source_name

Node (ingestion artifact)

id:ID, label, word_count:int, embedding, text, page_content, content, source_name

Topic / Concept / Entity
Multiple shapes observed, but minimally:

id always present

sometimes: name, source, description, location, is_rental

Relationship types (all observed; no relationship properties observed)

High-volume core:

PROVIDES

CAN_BE_PRESCRIBED_BY

PART_OF

LOCATED_IN

SUPPORTS

EXPLAINS_TOPIC

OFFERS

Commerce / availability:

RENTS_PRODUCT_FOR

SELLS

HAS_VARIANT

HAS_LOCATION

Support / eligibility / rules:

PROVIDES_SUPPORT_FOR

HELPS_WITH

FOR_EQUIPMENT_TYPE

FOR_SPECIALIZATION

IS_PRESCRIBED_BY

REQUIRES_INSURANCE_APPROVAL

REQUIRES_APPROVAL_BY

HAS_INSURANCE_COVERAGE

HAS_CIRCULATION_STATUS

HAS_RISK

HAS_CONDITION

COVERED_BY

EXCLUDED_FROM

APPROVES_REIMBURSEMENT_FOR

REQUIRES_BED_OWNERSHIP_BY

CAN_BE_PROVIDED_TO

FOLLOWS_GUIDELINE

APPLIES_TO

Typing / taxonomy:

IS_A

IS_A_TYPE_OF

IS_TYPE_OF

IS_A_SUBTYPE_OF

IS_A_CATEGORY

IS_NOT_A_CATEGORY

HAS_TYPE

IS_FOR

IS_ACCESSORY_FOR

IS_COMPATIBLE_WITH

IS_ASSOCIATED_WITH

Doc/metadata:

ABOUT

CONCERNS

INCLUDES

IS_INCLUDED_IN

IS_PART_OF

IS_OWNED_BY

OWNED_BY

CAN_BE_OWNED_BY

HAS_PREVIOUS_USER

IS_ABBREVIATION_FOR

LAST_UPDATED

Inferred core patterns (safe, based on types + labels present)

These are the “canonical traversals” your tests should expect to exist somewhere:

Text grounding: (Chunk)-[:PART_OF]->(Document) (strongly implied by your earlier Cypher and the presence of PART_OF + Chunk/Document)

Variants: (Equipment)-[:HAS_VARIANT]->(EquipmentVariant)

Prescription: (Equipment|EquipmentVariant)-[:CAN_BE_PRESCRIBED_BY|:IS_PRESCRIBED_BY]->(DoctorSpecialization|Medical*|Specialty|Specialization|Profession|Person)

Providers: (Organization|Company|Foundation)-[:PROVIDES|:OFFERS|:SUPPORTS|:PROVIDES_SUPPORT_FOR]->(Equipment|Topic|Support*)

Geo: (Organization|Company|Rental)-[:LOCATED_IN|:HAS_LOCATION]->(City|Location|Region)




================================================


{
  "contract_version": "1.0",
  "db": {
    "type": "neo4j",
    "must_support": {
      "labels": [
        "Equipment",
        "EquipmentVariant",
        "Organization",
        "Company",
        "Foundation",
        "City",
        "Document",
        "Chunk",
        "DoctorSpecialization",
        "Topic",
        "__Entity__",
        "Concept"
      ],
      "relationships": [
        "PART_OF",
        "HAS_VARIANT",
        "PROVIDES",
        "OFFERS",
        "SUPPORTS",
        "LOCATED_IN",
        "CAN_BE_PRESCRIBED_BY",
        "EXPLAINS_TOPIC"
      ],
      "vector_index_expected": {
        "name": "chunk_vector_index",
        "on_label": "Chunk",
        "property": "embedding"
      }
    }
  },
  "entities": {
    "Equipment": {
      "required_properties_any_of": [["name"], ["id"]],
      "optional_properties": [
        "category",
        "circulation",
        "general_doba_uziti",
        "general_approval_required",
        "general_approval_by",
        "general_approval_exceptions"
      ]
    },
    "EquipmentVariant": {
      "required_properties": ["id", "variant_name"],
      "optional_properties": [
        "search_text",
        "circulation",
        "coverage_czk_without_dph",
        "coverage_percentage",
        "coverage_note",
        "doba_uziti",
        "approval_required",
        "special_note"
      ]
    },
    "Document": {
      "required_properties_any_of": [["human_name"], ["title"], ["name"]],
      "optional_properties": ["url", "source", "id", "text", "content", "page_content", "embedding", "source_name"]
    },
    "Chunk": {
      "required_properties_any_of": [["text"], ["content"], ["page_content"]],
      "optional_properties": ["embedding", "word_count", "source_name", "id:ID", "label"]
    },
    "DoctorSpecialization": {
      "required_properties": ["name", "code"]
    }
  },
  "query_routes": {
    "TEXT": {
      "description": "Vector retrieval from Chunk -> Document; produces grounded excerpts + sources.",
      "must_traverse": [
        {"from": "Chunk", "rel": "PART_OF", "to": "Document"}
      ],
      "success_criteria": {
        "min_chunks": 1,
        "min_sources": 1
      }
    },
    "STRUCTURED": {
      "description": "Graph traversal for rules/providers/prescription/geo; no reliance on vector retrieval.",
      "must_traverse_any_of": [
        [
          {"from": "Equipment", "rel": "HAS_VARIANT", "to": "EquipmentVariant"}
        ],
        [
          {"from": "Equipment", "rel": "CAN_BE_PRESCRIBED_BY", "to_any_of": ["DoctorSpecialization", "Medicalspecialty", "Medical specialty", "Specialty", "Specialization", "Profession", "Person"]}
        ],
        [
          {"from_any_of": ["Organization", "Company", "Foundation"], "rel_any_of": ["PROVIDES", "OFFERS", "SUPPORTS", "PROVIDES_SUPPORT_FOR"], "to_any_of": ["Equipment", "Topic", "__Entity__"]}
        ],
        [
          {"from_any_of": ["Organization", "Company", "Rental"], "rel_any_of": ["LOCATED_IN", "HAS_LOCATION"], "to_any_of": ["City", "Location", "Region"]}
        ]
      ],
      "success_criteria": {
        "min_paths": 1,
        "min_results": 1
      }
    },
    "MIXED": {
      "description": "Vector retrieval to identify targets + structured traversal to validate constraints/providers.",
      "must_do": ["TEXT", "STRUCTURED"],
      "success_criteria": {
        "min_chunks": 1,
        "min_paths": 1
      }
    },
    "UNCLEAR": {
      "description": "Return clarification prompt; do not run expensive DB operations if intent cannot be established.",
      "success_criteria": {"clarification_returned": true}
    }
  },
  "e2e_tests": [
    {
      "id": "E2E-PRESCRIPTION-CHAIN",
      "purpose": "Verify equipment -> prescriber -> provider chain exists.",
      "cypher_template": "MATCH (e:Equipment)-[:CAN_BE_PRESCRIBED_BY]->(s) WITH e,s LIMIT 1 MATCH (p)-[:PROVIDES|:OFFERS|:SUPPORTS]->(e) RETURN e,s,p LIMIT 5",
      "assert": {
        "rows_min": 1,
        "must_include_labels": [["Equipment"], ["Organization", "Company", "Foundation"]]
      }
    },
    {
      "id": "E2E-VARIANT-COVERAGE",
      "purpose": "Verify equipment variants exist with coverage/frequency fields present somewhere.",
      "cypher_template": "MATCH (e:Equipment)-[:HAS_VARIANT]->(v:EquipmentVariant) WHERE v.variant_name IS NOT NULL RETURN e.name, v.variant_name, v.coverage_czk_without_dph, v.doba_uziti, v.approval_required LIMIT 20",
      "assert": {"rows_min": 1}
    },
    {
      "id": "E2E-GEO-AVAILABILITY",
      "purpose": "Verify provider/location path exists.",
      "cypher_template": "MATCH (org)-[:LOCATED_IN|:HAS_LOCATION]->(c) WHERE 'City' IN labels(c) RETURN org.name, c.name LIMIT 20",
      "assert": {"rows_min": 1}
    },
    {
      "id": "E2E-TEXT-GROUNDING",
      "purpose": "Verify chunk->document grounding exists and documents have names/urls.",
      "cypher_template": "MATCH (ch:Chunk)-[:PART_OF]->(d:Document) RETURN ch.text, d.human_name, d.url LIMIT 10",
      "assert": {"rows_min": 1}
    },
    {
      "id": "E2E-TOPIC-EXPLANATION",
      "purpose": "Verify document explanation links exist somewhere.",
      "cypher_template": "MATCH (d:Document)-[:EXPLAINS_TOPIC]->(t) RETURN d.human_name, labels(t), t.name LIMIT 20",
      "assert": {"rows_min": 1}
    }
  ],
  "nl_test_questions_cs": [
    "Který lékařský obor může předepsat konkrétní zdravotnický prostředek a jaké organizace jej následně poskytují?",
    "Jak často lze získat příspěvek nebo úhradu na konkrétní typ pomůcky a jaké jsou podmínky schválení?",
    "Které organizace v určitém městě půjčují nebo poskytují konkrétní pomůcku a jaké varianty existují?",
    "Jaké jsou podmínky pojišťovny pro úhradu elektrického vozíku (včetně případné potřeby schválení) a kdo jej může předepsat?",
    "Které dokumenty vysvětlují pravidla pro příspěvek na zvláštní pomůcku a na jaké typy pomůcek se vztahuje?"
  ]
}



