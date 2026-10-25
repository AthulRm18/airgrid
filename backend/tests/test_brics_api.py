import asyncio
import unittest
from unittest.mock import patch
import httpx
from app import main
from app.services import firebase_client as fb


class BricsAPITests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.patches = [
            patch.object(fb, '_using_firebase', False),
            patch.object(fb, '_loaded', True),
        ]
        for p in self.patches:
            p.start()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url='http://test')

    async def asyncTearDown(self):
        await self.client.aclose()
        for p in reversed(self.patches):
            p.stop()

    async def test_seed_demo_populates_models_and_resources(self):
        res = await self.client.post('/api/demo/seed')
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertGreater(data.get('shared_models', 0), 0)
        self.assertGreater(data.get('resource_requests', 0), 0)
        self.assertGreater(data.get('brics_events', 0), 0)

        # Verify status endpoint reflects them
        status_res = await self.client.get('/api/brics/status')
        self.assertEqual(status_res.status_code, 200)
        st = status_res.json()
        self.assertGreater(st['shared_models'], 0)
        self.assertGreater(st['resource_requests'], 0)

        # Verify models endpoint returns models
        models_res = await self.client.get('/api/brics/models')
        self.assertEqual(models_res.status_code, 200)
        models_data = models_res.json()
        self.assertGreater(models_data['count'], 0)
        first_model = models_data['models'][0]
        self.assertIn('origin_country', first_model)
        self.assertIn('model_name', first_model)

        # Verify resources endpoint returns requests
        reqs_res = await self.client.get('/api/brics/resources/requests')
        self.assertEqual(reqs_res.status_code, 200)
        reqs_data = reqs_res.json()
        self.assertGreater(reqs_data['count'], 0)
        first_req = reqs_data['requests'][0]
        self.assertIn('country_code', first_req)
        self.assertIn('priority', first_req)

    async def test_coordinator_can_share_model_and_request_resource(self):
        # Login as BRICS Coordinator
        login_res = await self.client.post('/api/auth/login', json={'username': 'brics.demo', 'password': 'demo123'})
        self.assertEqual(login_res.status_code, 200)
        token = login_res.json()['session_token']
        headers = {'X-Session-Token': token}

        # Share new model
        model_payload = {
            'origin_country': 'IN',
            'model_name': 'Test-Smog-Net',
            'model_version': 'v1.0',
            'target_variable': 'pm25',
            'horizon_hours': 24,
            'training_window_days': 14,
            'metrics': {'rmse': 5.2, 'r2': 0.94},
            'tags': ['test', 'neural-net'],
            'notes': 'Test model shared via API test'
        }
        share_res = await self.client.post('/api/brics/models/share', json=model_payload, headers=headers)
        self.assertEqual(share_res.status_code, 200)
        saved_model = share_res.json()
        self.assertEqual(saved_model['model_name'], 'Test-Smog-Net')

        # Request resource
        resource_payload = {
            'country_code': 'IN',
            'request_type': 'lidar_profiler',
            'reason': 'Urgent boundary layer profiling needed',
            'priority': 'urgent',
            'resources_needed': ['1x Mobile Raman LIDAR Unit']
        }
        req_res = await self.client.post('/api/brics/resources/request', json=resource_payload, headers=headers)
        self.assertEqual(req_res.status_code, 200)
        saved_req = req_res.json()
        self.assertEqual(saved_req['priority'], 'urgent')
