# frozen_string_literal: true

require 'digest'
require 'fileutils'
require 'json'
require 'tmpdir'

repo_root = File.expand_path('../..', __dir__)
plugin_dir = File.join(repo_root, 'sketchup_plugin', 'local_mcp_for_sketchup')
require File.join(plugin_dir, 'runtime_source_attestation')

def check!(condition, message)
  raise message unless condition
end

def expect_load_error(message)
  yield
rescue LoadError
  true
else
  raise message
end

tests = 0
boolean_expected = LocalMcpForSketchUp::RuntimeSourceManifest::BOOLEAN_OPERATIONS_SHA256
boolean_actual = Digest::SHA256.file(File.join(plugin_dir, 'boolean_operations.rb')).hexdigest
model_revision_expected = LocalMcpForSketchUp::RuntimeSourceManifest::MODEL_REVISION_SHA256
model_revision_actual = Digest::SHA256.file(File.join(plugin_dir, 'model_revision.rb')).hexdigest
tests += 1; check!(boolean_expected.match?(/\A[0-9a-f]{64}\z/), 'Boolean manifest hash must be a lowercase SHA-256')
tests += 1; check!(boolean_actual == boolean_expected, 'tracked manifest must match boolean_operations.rb')
tests += 1; check!(model_revision_expected.match?(/\A[0-9a-f]{64}\z/), 'Model Revision manifest hash must be a lowercase SHA-256')
tests += 1; check!(model_revision_actual == model_revision_expected, 'tracked manifest must match model_revision.rb')

Dir.mktmpdir('local-mcp-runtime-source-attestation-') do |root|
  source = File.join(root, 'boolean_operations.rb')
  FileUtils.cp(File.join(plugin_dir, 'boolean_operations.rb'), source)
  yielded_path = nil
  loaded = LocalMcpForSketchUp::RuntimeSourceAttestation.attest_boolean_operations!(root) do |path|
    yielded_path = path
    true
  end
  tests += 1; check!(yielded_path == source, 'attestation must yield the exact verified source path')
  tests += 1; check!(loaded == boolean_expected, 'attestation must return the loaded source hash')
  tests += 1; check!(LocalMcpForSketchUp::RuntimeSourceAttestation.loaded_boolean_operations_sha256 == boolean_expected, 'loaded hash must remain available after the load boundary')

  tests += 1
  expect_load_error('an already-loaded require no-op must fail closed') do
    LocalMcpForSketchUp::RuntimeSourceAttestation.attest_boolean_operations!(root) { false }
  end

  File.open(source, 'ab') { |file| file.write("# tampered before load\n") }
  tests += 1
  expect_load_error('pre-load source drift must fail closed') do
    LocalMcpForSketchUp::RuntimeSourceAttestation.attest_boolean_operations!(root) { nil }
  end

  FileUtils.cp(File.join(plugin_dir, 'boolean_operations.rb'), source)
  tests += 1
  expect_load_error('source changes across the require boundary must fail closed') do
    LocalMcpForSketchUp::RuntimeSourceAttestation.attest_boolean_operations!(root) do |path|
      File.open(path, 'ab') { |file| file.write("# changed during load\n") }
      true
    end
  end
end

Dir.mktmpdir('local-mcp-model-revision-source-attestation-') do |root|
  source = File.join(root, 'model_revision.rb')
  FileUtils.cp(File.join(plugin_dir, 'model_revision.rb'), source)
  yielded_path = nil
  loaded = LocalMcpForSketchUp::RuntimeSourceAttestation.attest_model_revision!(root) do |path|
    yielded_path = path
    true
  end
  tests += 1; check!(yielded_path == source, 'Model Revision attestation must yield the exact verified source path')
  tests += 1; check!(loaded == model_revision_expected, 'Model Revision attestation must return the loaded source hash')
  tests += 1; check!(LocalMcpForSketchUp::RuntimeSourceAttestation.loaded_model_revision_sha256 == model_revision_expected, 'loaded Model Revision hash must remain available after the load boundary')

  tests += 1
  expect_load_error('an already-loaded Model Revision require no-op must fail closed') do
    LocalMcpForSketchUp::RuntimeSourceAttestation.attest_model_revision!(root) { false }
  end

  File.open(source, 'ab') { |file| file.write("# tampered before load\n") }
  tests += 1
  expect_load_error('Model Revision pre-load source drift must fail closed') do
    LocalMcpForSketchUp::RuntimeSourceAttestation.attest_model_revision!(root) { nil }
  end

  FileUtils.cp(File.join(plugin_dir, 'model_revision.rb'), source)
  tests += 1
  expect_load_error('Model Revision source changes across the require boundary must fail closed') do
    LocalMcpForSketchUp::RuntimeSourceAttestation.attest_model_revision!(root) do |path|
      File.open(path, 'ab') { |file| file.write("# changed during load\n") }
      true
    end
  end
end

puts JSON.generate({
  ok: true,
  tests: tests,
  boolean_operations_sha256: boolean_expected,
  model_revision_source_sha256: model_revision_expected,
  require_noop_rejected: true,
  pre_load_drift_rejected: true,
  load_boundary_drift_rejected: true
})
