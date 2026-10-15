require 'minitest/autorun'
require 'json'
require 'fileutils'
require 'tmpdir'

module TimingQueueFixture
  extend self
  ROOT = Dir.mktmpdir('native-queue-timing-')
  QUEUE_DIR = File.join(ROOT, 'queue')
  PROCESSING_DIR = File.join(ROOT, 'processing')
  FileUtils.mkdir_p([QUEUE_DIR, PROCESSING_DIR])
  def dispatch(method, _params)
    raise 'fixture failure' if method == 'fail'
    { 'revision' => 'unchanged' }
  end
  def queue_error_payload(_error, _request); { 'code' => 'FIXTURE' }; end
  def write_response(id, body); (@responses ||= {})[id] = body; end
  def responses; @responses; end
end
source = File.read(File.expand_path('../../sketchup_plugin/alma_sketchup_mcp.rb', __dir__))
body = source.split("  def process_pending_requests\n", 2).fetch(1).split("  def add_warning", 2).first
TimingQueueFixture.module_eval("def process_pending_requests\n#{body}", __FILE__, __LINE__)
Minitest.after_run { FileUtils.remove_entry(TimingQueueFixture::ROOT) }

class QueueTimingTest < Minitest::Test
  def test_transport_timing_is_outside_success_and_error_results
    %w[inspect fail].each do |method|
      File.write(File.join(TimingQueueFixture::QUEUE_DIR, "#{method}.json"), JSON.generate('id' => method, 'method' => method))
      TimingQueueFixture.process_pending_requests
      body = TimingQueueFixture.responses.fetch(method)
      timing = body.fetch(:timing)
      assert_equal 'native-queue-timing.v1', timing['version']
      assert_operator timing['finished_at_ms'], :>=, timing['started_at_ms']
      assert timing['dispatch_elapsed_ms'].finite?
      assert_operator timing['dispatch_elapsed_ms'], :>=, 0
      assert_equal(method == 'fail' ? {'code' => 'FIXTURE'} : {'revision' => 'unchanged'}, body[method == 'fail' ? :error : :result])
      assert_empty Dir[File.join(TimingQueueFixture::PROCESSING_DIR, '*.json')]
    end
  end
end
