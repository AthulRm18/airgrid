import asyncio
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from app import main
from app.services import firebase_client as fb
from app.services import gemini_client as gemini
from test_gemini_client import PHOTO, TEXT

class AnalysisAPITests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.patches = [
            patch.object(fb, '_FALLBACK_STORE', {'citizen_reports': [], 'incidents': [],
                'alerts': {}, 'issued_alerts': {}, 'dismissed': {}, 'active_sessions': {}, 'federated_events': []}),
            patch.object(fb, '_PERSIST_PATH', Path(self.temp.name) / 'state.json'),
            patch.object(fb, '_init_firebase'), patch.object(fb, '_loaded', True),
            patch.object(fb, '_using_firebase', False), patch.object(main, 'INCIDENTS', []),
            patch.object(main, '_BACKGROUND_TASKS', set()), patch.object(main, '_EVIDENCE_CACHE', {}),
            patch.object(main, '_EVIDENCE_INFLIGHT', {}), patch.object(main, '_CACHE_GENERATION', 0),
        ]
        for p in self.patches:
            p.start()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url='http://test')

    async def asyncTearDown(self):
        tasks = list(main._BACKGROUND_TASKS)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await self.client.aclose()
        for p in reversed(self.patches):
            p.stop()
        self.temp.cleanup()

    async def test_report_is_saved_before_parallel_analysis_completes(self):
        release = asyncio.Event()
        started_text, started_photo = asyncio.Event(), asyncio.Event()
        async def text(*args):
            started_text.set()
            await release.wait()
            return {**TEXT, 'analysis_status': 'live', 'analysis_source': 'gemini'}
        async def photo(*args):
            started_photo.set()
            await release.wait()
            return {**PHOTO, 'haze_score': 0.0, 'analysis_status': 'live', 'analysis_source': 'gemini'}
        with patch.object(gemini, 'is_configured', return_value=True), \
             patch.object(gemini, 'classify_text_report', side_effect=text), \
             patch.object(gemini, 'score_photo', side_effect=photo):
            started = time.monotonic()
            response = await self.client.post('/api/incidents/report', data={'lat': '28.64', 'lng': '77.31', 'text': 'Smoke'},
                files={'file': ('photo.png', b'photo', 'image/png')})
            self.assertLess(time.monotonic() - started, 0.2)
            self.assertEqual(response.status_code, 200)
            incident = response.json()
            self.assertEqual(incident['analysis_status'], 'pending')
            self.assertEqual(len(fb.get_all_citizen_reports()), 1)
            await asyncio.wait_for(asyncio.gather(started_text.wait(), started_photo.wait()), 0.2)
            pending = (await self.client.get('/api/incidents/' + incident['incident_id'])).json()
            self.assertIsNone(pending['photo_analysis']['smoke_visible'])
            release.set()
            await asyncio.gather(*list(main._BACKGROUND_TASKS))
            completed = (await self.client.get('/api/incidents/' + incident['incident_id'])).json()
        self.assertEqual(completed['analysis_status'], 'live')
        self.assertEqual(completed['photo_analysis']['haze_score'], 0)
        self.assertEqual(len(fb.get_all_incidents()), 1)
        persisted = json.loads(fb._PERSIST_PATH.read_text())
        self.assertEqual(persisted['incidents'][0]['analysis_status'], 'live')
        self.assertGreater(main._CACHE_GENERATION, 1)

    async def test_missing_key_saves_photo_without_inventing_detection(self):
        with patch.object(gemini, 'is_configured', return_value=False):
            response = await self.client.post('/api/incidents/report', data={'lat': '28.64', 'lng': '77.31'},
                files={'file': ('photo.png', b'photo', 'image/png')})
        result = response.json()
        self.assertEqual(result['analysis_status'], 'unavailable')
        self.assertIsNone(result['photo_analysis']['haze_score'])
        self.assertIsNone(result['photo_analysis']['smoke_visible'])
        self.assertEqual(len(fb.get_all_incidents()), 1)

    async def test_shutdown_does_not_leave_report_pending(self):
        blocked = asyncio.Event()
        async def slow(*args):
            blocked.set()
            await asyncio.sleep(10)
        with patch.object(gemini, 'is_configured', return_value=True), patch.object(gemini, 'score_photo', side_effect=slow):
            response = await self.client.post('/api/incidents/report', data={'lat': '28.64', 'lng': '77.31'},
                files={'file': ('photo.png', b'photo', 'image/png')})
            await blocked.wait()
            task = next(iter(main._BACKGROUND_TASKS))
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        result = (await self.client.get('/api/incidents/' + response.json()['incident_id'])).json()
        self.assertEqual(result['analysis_status'], 'unavailable')
        self.assertEqual(result['photo_analysis']['analysis_reason'], 'interrupted')

    async def test_failed_photo_preserves_successful_text_analysis(self):
        with patch.object(gemini, 'is_configured', return_value=True), \
             patch.object(gemini, 'classify_text_report', new=AsyncMock(return_value={**TEXT, 'analysis_status': 'live'})), \
             patch.object(gemini, 'score_photo', new=AsyncMock(return_value=gemini.unavailable_photo('timeout'))):
            response = await self.client.post('/api/incidents/report', data={'lat': '28.64', 'lng': '77.31', 'text': 'Smoke'},
                files={'file': ('photo.png', b'photo', 'image/png')})
            await asyncio.gather(*list(main._BACKGROUND_TASKS))
        result = (await self.client.get('/api/incidents/' + response.json()['incident_id'])).json()
        self.assertEqual(result['analysis_status'], 'partial')
        self.assertEqual(result['text_analysis']['analysis_status'], 'live')
        self.assertIsNone(result['photo_analysis']['smoke_visible'])

    async def test_invalid_upload_does_not_create_a_report(self):
        response = await self.client.post('/api/incidents/report', data={'lat': '28.64', 'lng': '77.31'},
            files={'file': ('photo.svg', b'<svg/>', 'image/svg+xml')})
        self.assertEqual(response.status_code, 415)
        self.assertEqual(fb.get_all_citizen_reports(), [])

    async def test_oversized_upload_does_not_create_a_report(self):
        with patch.object(main, '_MAX_PHOTO_BYTES', 4):
            response = await self.client.post('/api/incidents/report', data={'lat': '28.64', 'lng': '77.31'},
                files={'file': ('photo.png', b'12345', 'image/png')})
        self.assertEqual(response.status_code, 413)
        self.assertEqual(fb.get_all_citizen_reports(), [])

    async def test_fast_evidence_does_not_wait_on_weather_or_gemini(self):
        cell = '873da1149ffffff'
        hotspot = {'h3_cell': cell, 'severity': 'hidden', 'confidence_score': 0.5,
                   'citizen_report_count': 3, 'explanation': 'Reported pollution.', 'lat': 28.6, 'lng': 77.3}
        with patch.object(main, '_get_hotspots_cached', new=AsyncMock(return_value={'hotspots': [hotspot]})), \
             patch.object(main, '_get_historical_df'), patch.object(main.forecast, 'is_trained', return_value=True), \
             patch.object(main.forecast, 'forecast_cell', return_value=[]), \
             patch.object(gemini, 'is_configured', return_value=True), \
             patch.object(gemini, 'analyze_evidence', new=AsyncMock()) as ai, \
             patch.object(main.weather_client, 'fetch_weather', new=AsyncMock()) as weather:
            result = await self.client.get(f'/api/hotspots/{cell}/evidence?fast=true')
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()['ai_analysis']['status'], 'pending')
        ai.assert_not_awaited()
        weather.assert_not_awaited()

    async def test_evidence_generation_is_shared_and_invalidated_by_new_data(self):
        calls = 0
        async def build(*args, **kwargs):
            nonlocal calls
            calls += 1
            await asyncio.sleep(0.01)
            return {'ai_analysis': {'status': 'live'}, 'incident_explanation': {'summary': str(calls)}}
        with patch.object(main, '_build_evidence_payload', side_effect=build):
            results = await asyncio.gather(*(main._get_evidence_cached('cell', 300) for _ in range(8)))
            self.assertEqual(calls, 1)
            self.assertTrue(all(r['incident_explanation']['summary'] == '1' for r in results))
            main._invalidate_runtime_caches()
            await main._get_evidence_cached('cell', 300)
            self.assertEqual(calls, 2)

    async def test_invalidation_during_generation_prevents_stale_cache_write(self):
        started, release = asyncio.Event(), asyncio.Event()
        async def build(*args, **kwargs):
            started.set()
            await release.wait()
            return {'ai_analysis': {'status': 'live'}}
        with patch.object(main, '_build_evidence_payload', side_effect=build):
            request = asyncio.create_task(main._get_evidence_cached('cell', 300))
            await started.wait()
            main._invalidate_runtime_caches()
            release.set()
            await request
        self.assertNotIn('cell', main._EVIDENCE_CACHE)

    async def test_fallback_evidence_can_recover_after_short_cache(self):
        main._EVIDENCE_CACHE['cell'] = {'ts': time.monotonic() - 6, 'payload': {'ai_analysis': {'status': 'unavailable'}}}
        with patch.object(main, '_build_evidence_payload', new=AsyncMock(return_value={'ai_analysis': {'status': 'live'}})) as build:
            result = await main._get_evidence_cached('cell', 300)
        self.assertEqual(result['ai_analysis']['status'], 'live')
        build.assert_awaited_once()
