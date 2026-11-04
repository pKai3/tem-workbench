"""Demo HTTPS trust selection and certificate-failure behaviour."""
import ssl
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
from urllib.error import URLError

import demo_packs


class DownloadTLSTests(unittest.TestCase):
    def test_windows_uses_native_trust_without_global_ssl_changes(self):
        native = Mock()
        original = ssl.SSLContext
        with patch.object(demo_packs.sys, 'platform', 'win32'), \
             patch.dict(sys.modules, {'truststore': native}):
            context = demo_packs.download_context()
        native.SSLContext.assert_called_once_with(ssl.PROTOCOL_TLS_CLIENT)
        self.assertIs(context, native.SSLContext.return_value)
        self.assertIs(ssl.SSLContext, original)

    @unittest.skipUnless(sys.platform == 'win32', 'Requires Windows native trust')
    def test_native_windows_context_requires_certificate_and_hostname(self):
        import truststore
        context = demo_packs.download_context()
        self.assertIsInstance(context, truststore.SSLContext)
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(context.check_hostname)

    def test_certificate_failure_never_retries_without_verification(self):
        context = object()
        error = URLError(ssl.SSLCertVerificationError(1, 'self-signed certificate in chain'))
        with tempfile.TemporaryDirectory() as folder:
            download = demo_packs.DemoDownload(folder)
            with patch.object(demo_packs, 'download_context', return_value=context), \
                 patch('urllib.request.urlopen', side_effect=error) as request, \
                 patch.object(demo_packs, 'install_archive') as install:
                download.work('https://example.test/demo.zip')
            self.assertEqual(request.call_count, 1)
            self.assertIs(request.call_args.kwargs['context'], context)
            install.assert_not_called()
            self.assertEqual(download.status()['state'], 'failed')
            self.assertIn('certificate could not be verified', download.status()['message'])
            self.assertIn('Certificate verification remains enabled', download.status()['message'])

    def test_non_windows_context_keeps_verification_enabled(self):
        if sys.platform == 'win32':
            self.skipTest('Non-Windows context')
        context = demo_packs.download_context()
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(context.check_hostname)
