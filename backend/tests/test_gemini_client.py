import asyncio
import json
import time
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from google import genai
from google.genai import types
from app.services import gemini_client as gemini

PHOTO = {
    'smoke_visible': False, 'haze_visible': True, 'visibility_reduced': False,
    'possible_source': 'dust', 'visual_confidence': 0.8, 'haze_score': 0.3,
    'notes': 'Light haze is visible; the source is uncertain.',
}
TEXT = {
    'translated_text': 'Smoke near the factory', 'detected_language': 'Hindi',
    'event_type': 'smoke', 'severity': 'moderate', 'possible_source': 'unclear',
    'haze_score': 0.5, 'reported_symptoms': [], 'extracted_location_hint': None,
    'confidence': 0.8,
}
EVIDENCE = {
    'incident_explanation': {
        'incident_title': 'Pollution reported', 'severity_assessment': 'MODERATE',
        'summary': 'Citizen reports support this zone. Field verification is needed.',
        'evidence_signals': ['Three citizen reports'], 'likely_cause': 'Unconfirmed',
        'confidence_note': 'Synthetic satellite data; source is unconfirmed.',
    },
    'recommendation': {
        'urgency': 'WITHIN_1_HOUR', 'actions': [
            {'priority': 1, 'action': 'Verify the source', 'rationale': 'No ground confirmation'}],
        'monitoring_recommendations': 'Monitor nearby cells.',
        'public_advisory_needed': False, 'advisory_text': None,
    },
}

class ProviderError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__('Provider error; details must not reach the response')

class GeminiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        gemini._CACHE.clear()
        gemini._TEXT_CACHE.clear()
        gemini._INFLIGHT.clear()
        gemini._MODEL_COOLDOWNS.clear()
        gemini._SERVICE_COOLDOWN = 0
        gemini._SLOTS = asyncio.Semaphore(4)
        self.generate = AsyncMock(return_value=SimpleNamespace(text=json.dumps(PHOTO)))
        self.client = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=self.generate)))
        self.patches = [patch.object(gemini, '_get_client', return_value=self.client),
                        patch.object(gemini, 'MODEL_CANDIDATES', ['gemini-3.5-flash-lite', 'gemini-3.8-flash']),
                        patch.object(gemini.logger, 'warning')]
        for p in self.patches:
            p.start()

    async def asyncTearDown(self):
        tasks = list(gemini._INFLIGHT.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        for p in reversed(self.patches):
            p.stop()

    async def test_same_photo_is_shared_and_cached(self):
        async def slow(**kwargs):
            await asyncio.sleep(0.02)
            return SimpleNamespace(text=json.dumps(PHOTO))
        self.generate.side_effect = slow
        results = await asyncio.gather(*(gemini.score_photo(b'same-photo') for _ in range(8)))
        self.assertTrue(all(r['analysis_status'] == 'live' for r in results))
        self.assertEqual(self.generate.await_count, 1)
        cached = await gemini.score_photo(b'same-photo')
        self.assertTrue(cached['analysis_cached'])
        cached['smoke_visible'] = True
        self.assertFalse((await gemini.score_photo(b'same-photo'))['smoke_visible'])
        config = self.generate.call_args.kwargs['config']
        self.assertEqual(config.http_options.retry_options.attempts, 1)
        self.assertEqual(config.response_mime_type, 'application/json')

    async def test_timeout_cancels_request_then_fallback_succeeds(self):
        cancelled = asyncio.Event()
        async def generate(**kwargs):
            if kwargs['model'] == 'gemini-3.5-flash-lite':
                try:
                    await asyncio.sleep(10)
                finally:
                    cancelled.set()
            return SimpleNamespace(text=json.dumps(PHOTO))
        self.generate.side_effect = generate
        started = time.monotonic()
        with patch.object(gemini, 'REQUEST_BUDGET', 0.1), patch.object(gemini, 'ATTEMPT_BUDGET', 0.025):
            result = await gemini.score_photo(b'timeout-photo')
        self.assertLess(time.monotonic() - started, 0.3)
        self.assertTrue(cancelled.is_set())
        self.assertEqual(result['analysis_model'], 'gemini-3.8-flash')

    async def test_total_deadline_includes_all_attempts(self):
        async def hang(**kwargs):
            await asyncio.sleep(10)
        self.generate.side_effect = hang
        started = time.monotonic()
        with patch.object(gemini, 'REQUEST_BUDGET', 0.04), patch.object(gemini, 'ATTEMPT_BUDGET', 0.03):
            result = await gemini.score_photo(b'hanging-photo')
        self.assertLess(time.monotonic() - started, 0.25)
        self.assertEqual(result['analysis_status'], 'unavailable')
        self.assertEqual(result['analysis_reason'], 'timeout')
        self.assertIsNone(result['smoke_visible'])
        self.assertIsNone(result['haze_score'])
        self.assertIsNone(result['visual_confidence'])

    async def test_queue_wait_is_also_bounded(self):
        with patch.object(gemini, '_SLOTS', asyncio.Semaphore(0)), patch.object(gemini, 'REQUEST_BUDGET', 0.025):
            result = await gemini.score_photo(b'queued-photo')
        self.assertEqual(result['analysis_reason'], 'timeout')
        self.generate.assert_not_awaited()

    async def test_unsupported_model_is_cooled_down(self):
        async def generate(**kwargs):
            if kwargs['model'] == 'gemini-3.5-flash-lite':
                raise ProviderError(404)
            return SimpleNamespace(text=json.dumps(PHOTO))
        self.generate.side_effect = generate
        await gemini.score_photo(b'first')
        await gemini.score_photo(b'second')
        self.assertEqual([c.kwargs['model'] for c in self.generate.call_args_list],
                         ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.8-flash'])

    async def test_rate_limit_stops_retries_across_requests(self):
        self.generate.side_effect = ProviderError(429)
        first = await gemini.score_photo(b'first')
        second = await gemini.score_photo(b'second')
        self.assertEqual(first['analysis_reason'], 'rate_limited')
        self.assertEqual(second['analysis_reason'], 'service_cooldown')
        self.assertEqual(self.generate.await_count, 1)

    async def test_invalid_scores_never_become_visual_evidence(self):
        invalid = {**PHOTO, 'haze_score': 9}
        self.generate.return_value = SimpleNamespace(text=json.dumps(invalid))
        result = await gemini.score_photo(b'invalid')
        self.assertEqual(result['analysis_status'], 'unavailable')
        self.assertEqual(result['analysis_reason'], 'invalid_response')
        self.assertIsNone(result['smoke_visible'])

    async def test_missing_key_keeps_original_voice_and_photo_unassessed(self):
        with patch.object(gemini, '_get_client', return_value=None):
            photo = await gemini.score_photo(b'photo')
            voice = await gemini.classify_text_report('धुआँ दिख रहा है', 'hi-IN')
        self.assertEqual(voice['translated_text'], 'धुआँ दिख रहा है')
        self.assertEqual(voice['event_type'], 'unclear')
        self.assertEqual(voice['confidence'], 0)
        self.assertIsNone(photo['smoke_visible'])
        self.assertEqual(photo['analysis_reason'], 'missing_api_key')

    async def test_voice_translation_is_reused_when_submitted(self):
        self.generate.return_value = SimpleNamespace(text=json.dumps(TEXT))
        first = await gemini.classify_text_report('कारखाने के पास धुआँ', 'hi-IN')
        submitted = await gemini.classify_text_report(first['translated_text'])
        self.assertEqual(submitted['event_type'], 'smoke')
        self.assertTrue(submitted['analysis_cached'])
        self.assertEqual(self.generate.await_count, 1)

    async def test_evidence_uses_one_request_and_only_corridor_aggregates(self):
        self.generate.return_value = SimpleNamespace(text=json.dumps(EVIDENCE))
        result = await gemini.analyze_evidence({'h3_cell': 'cell', 'corridor_impact':
                    {'total_population_at_risk': 100, 'cell_impacts': [{'population': 100}]}})
        self.assertEqual(result['analysis_status'], 'live')
        self.assertEqual(result['incident_explanation']['analysis_source'], 'gemini')
        self.assertEqual(self.generate.await_count, 1)
        self.assertNotIn('cell_impacts', self.generate.call_args.kwargs['contents'])

    async def test_real_sdk_serializes_structured_photo_request(self):
        requests = []
        async def transport(request):
            requests.append(json.loads(request.content))
            return httpx.Response(200, json={'candidates': [{'content': {'role': 'model',
                'parts': [{'text': json.dumps(PHOTO)}]}, 'finishReason': 'STOP'}]})
        client = genai.Client(api_key='test-placeholder', http_options=types.HttpOptions(
            async_client_args={'transport': httpx.MockTransport(transport)},
            retry_options=types.HttpRetryOptions(attempts=1)))
        try:
            with patch.object(gemini, '_get_client', return_value=client):
                result = await gemini.score_photo(b'photo-bytes', 'image/png')
        finally:
            await client.aio.aclose()
            client.close()
        self.assertEqual(result['analysis_status'], 'live')
        self.assertEqual(len(requests), 1)
        self.assertEqual(requests[0]['generationConfig']['responseMimeType'], 'application/json')
        self.assertIn('responseSchema', requests[0]['generationConfig'])
        image = requests[0]['contents'][0]['parts'][0]['inlineData']
        self.assertEqual(image.get('mimeType', image.get('mime_type')), 'image/png')
