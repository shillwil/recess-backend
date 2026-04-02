# Frontend Implementation Guide: AI Generation Improvements

You are implementing three backend features that were just added to the Recess backend API. This document describes the API contract changes and the UI work needed on the iOS client.

## Important Context

- The backend is a Node.js/Express REST API
- Auth is Firebase JWT tokens sent as `Authorization: Bearer <token>`
- All responses follow the pattern: `{ success: boolean, data?: any, message?: string, correlationId: string }`
- The backend is hosted on Railway (staging branch auto-deploys)

---

## Feature 1: Selective Template Cleanup on Program Delete

### What changed

When a user deletes an AI-generated program, the backend can now also delete the AI-generated templates that were created with it. The user can selectively choose which templates to **keep** — everything else gets deleted (if it's AI-generated and not used in another program).

### API Contract

```
DELETE /api/programs/:id?deleteTemplates=true
Content-Type: application/json
Authorization: Bearer <token>

Body (optional):
{
  "keepTemplateIds": ["uuid-1", "uuid-2"]  // templates to preserve
}

Response:
{
  "success": true,
  "message": "Program deleted successfully",
  "data": {
    "templatesRemoved": 3
  },
  "correlationId": "..."
}
```

**Behavior:**
- `deleteTemplates` query param is required to enable cleanup (default false for backward compat)
- `keepTemplateIds` is optional — omit it or send `[]` to delete ALL orphaned AI templates
- Only AI-generated templates are ever deleted — manually created templates are always safe
- Templates used in other programs are never deleted regardless of keepTemplateIds
- If `deleteTemplates` is not set to `true`, the body is ignored and templates are preserved (old behavior)

### UI to Build

When the user taps delete on a program that has AI-generated templates, show a confirmation screen **before** calling the API:

1. **Header**: "Delete [Program Name]?"
2. **Subheader/description**: "This program has [N] templates. Select any you'd like to keep."
3. **Template list**: Show each template linked to this program as a selectable row. Each row should show:
   - Template name
   - Number of exercises (available from the program detail response)
   - A toggle/checkbox — **default state is UNCHECKED** (meaning it will be deleted)
   - When the user taps a row, it toggles to "keep" (checked)
4. **"Delete All Templates" button**: Unchecks all rows (convenience shortcut). This should be below the list.
5. **Confirm button**: "Delete Program" — fires the DELETE request

**How to get the template list**: You already have this data. When viewing a program, `GET /api/programs/:id` returns:
```json
{
  "workouts": [
    {
      "dayNumber": 0,
      "dayLabel": "Push Day",
      "template": {
        "id": "template-uuid",
        "name": "Push Hypertrophy A",
        "exerciseCount": 6
      }
    }
  ]
}
```

Extract the template IDs and names from the workouts array.

**Building the request**: Collect the IDs of templates the user checked (wants to keep) and send them as `keepTemplateIds`:

```swift
// Pseudocode
let keepIds = templates.filter { $0.isChecked }.map { $0.id }

// DELETE request with body
var request = URLRequest(url: URL(string: "\(baseURL)/api/programs/\(programId)?deleteTemplates=true")!)
request.httpMethod = "DELETE"
request.setValue("application/json", forHTTPHeaderField: "Content-Type")

if !keepIds.isEmpty {
    let body = ["keepTemplateIds": keepIds]
    request.httpBody = try JSONSerialization.data(withJSONObject: body)
}
```

**After deletion**: You can optionally show a toast/banner: "Deleted program and [N] templates" using `data.templatesRemoved` from the response.

**Edge case**: If the program has no AI-generated templates (all templates were manually created), skip the template selection UI entirely and just show a simple "Delete program?" confirmation.

---

## Feature 2: Enhanced Progress Tracking

### What changed

The backend now computes training progress trends over 1-6 months (weight progression, stall detection, volume trends) and feeds them to Gemini automatically when generating programs.

### Frontend work needed

**None.** This is entirely backend-side. As long as the app sends `useTrainingHistory: true` in the generate-program request (which it already does), the backend will automatically include progress trends in the Gemini prompt when the user has 8+ workouts over the past 3 months.

---

## Feature 3: Template Reuse in AI Generation

### What changed

Users can now select existing templates for the AI to reuse/refresh instead of always creating brand new ones. When templates are selected for reuse, Gemini receives them as context and can update them in-place (swap exercises, adjust sets/reps) rather than creating duplicates.

### API Contract

```
POST /api/ai/generate-program
Content-Type: application/json
Authorization: Bearer <token>

{
  "inspirationSource": "Jeff Nippard hypertrophy",
  "daysPerWeek": 4,
  "sessionDurationMinutes": 60,
  "experienceLevel": "intermediate",
  "goal": "hypertrophy",
  "equipment": ["barbell", "dumbbell", "cable"],
  "useTrainingHistory": true,
  "reuseTemplateIds": ["uuid-1", "uuid-2"]  // NEW — optional
}
```

**Validation rules for `reuseTemplateIds`:**
- Optional field — omit it entirely to use the existing behavior (all new templates)
- Must be an array of valid UUIDs
- Maximum 7 entries
- The backend automatically filters out templates that aren't AI-generated or are in an active program, so it's safe to send whatever the user selects

**Response changes** — each workout's template now includes `wasReused`:

```json
{
  "program": {
    "workouts": [
      {
        "dayNumber": 0,
        "dayLabel": "Push Day",
        "template": {
          "id": "uuid-1",
          "name": "Push Hypertrophy A",
          "exerciseCount": 6,
          "wasReused": true,
          "exercises": [...]
        }
      },
      {
        "dayNumber": 1,
        "dayLabel": "Pull Day",
        "template": {
          "id": "new-uuid",
          "name": "Pull Hypertrophy",
          "exerciseCount": 7,
          "wasReused": false,
          "exercises": [...]
        }
      }
    ]
  },
  "generation": {
    "timeMs": 8500,
    "model": "gemini-3.1-flash-lite-preview",
    "usedTrainingHistory": true,
    "personalizationSource": "training_history"
  }
}
```

### UI to Build

Add a template reuse step to the AI program generation flow:

1. **Toggle**: Add a toggle/switch in the generation form: "Reuse existing templates?"
   - Default: OFF
   - When OFF, the existing flow works unchanged — no `reuseTemplateIds` is sent

2. **Template picker** (shown when toggle is ON):
   - Fetch the user's templates via `GET /api/templates`
   - Display as a selectable list with multi-select
   - Each row should show: template name, exercise count
   - Ideally filter to only show AI-generated templates (the backend filters anyway, but it's cleaner UX to not show manual ones)
   - The user taps to select which templates they want the AI to refresh/reuse

3. **Send selected IDs**: Add the selected template IDs to the generate-program request body as `reuseTemplateIds`

4. **Results screen**: Use `wasReused` on each workout's template to show a visual indicator:
   - `wasReused: true` — show a badge like "Updated" or "Refreshed"
   - `wasReused: false` — show "New" or no badge

### Template list endpoint (already exists)

```
GET /api/templates
Authorization: Bearer <token>

Response:
{
  "templates": [
    {
      "id": "uuid",
      "name": "Push Day A",
      "description": "...",
      "exerciseCount": 6,
      "isPublic": false,
      "createdAt": "2026-03-15T...",
      "updatedAt": "2026-03-15T..."
    }
  ],
  "pagination": { "nextCursor": null, "hasMore": false }
}
```

Note: This list endpoint does not include `isAiGenerated`. If you want to filter client-side, you'd need to check the template detail endpoint (`GET /api/templates/:id`) which does include `isAiGenerated`. Alternatively, just show all templates and let the backend filter — it silently ignores non-AI-generated templates in the `reuseTemplateIds` array.

---

## Summary

| Feature | Frontend effort | Key UI element |
|---------|----------------|---------------|
| Template cleanup on delete | Moderate | Confirmation screen with selectable template list + "Delete All Templates" button |
| Progress tracking | None | Automatic — backend handles everything |
| Template reuse | Moderate | Toggle + template picker in generation flow, "Updated"/"New" badges on results |
