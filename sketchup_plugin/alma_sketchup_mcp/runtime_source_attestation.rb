# frozen_string_literal: true

require 'digest'
require_relative 'runtime_source_manifest'

module AlmaSketchupMCP
  module RuntimeSourceAttestation
    extend self

    def attest_boolean_operations!(source_directory, &loader)
      @loaded_boolean_operations_sha256 = attest_source!(
        source_directory,
        RuntimeSourceManifest::BOOLEAN_OPERATIONS_RELATIVE_PATH,
        RuntimeSourceManifest::BOOLEAN_OPERATIONS_SHA256,
        'Boolean',
        &loader
      )
    end

    def attest_model_revision!(source_directory, &loader)
      @loaded_model_revision_sha256 = attest_source!(
        source_directory,
        RuntimeSourceManifest::MODEL_REVISION_RELATIVE_PATH,
        RuntimeSourceManifest::MODEL_REVISION_SHA256,
        'Model revision',
        &loader
      )
    end

    def loaded_boolean_operations_sha256
      @loaded_boolean_operations_sha256 ||
        raise(LoadError, 'Boolean runtime source has not completed attestation.')
    end

    def loaded_model_revision_sha256
      @loaded_model_revision_sha256 ||
        raise(LoadError, 'Model revision runtime source has not completed attestation.')
    end

    private

    def attest_source!(source_directory, relative_path, expected, label)
      source_path = File.join(source_directory, relative_path)
      before_load = Digest::SHA256.file(source_path).hexdigest
      unless before_load == expected
        raise LoadError, "#{label} runtime source does not match the tracked manifest before load."
      end

      load_result = yield source_path
      unless load_result == true
        raise LoadError, "#{label} runtime source was already loaded or did not load at the attested require boundary."
      end

      after_load = Digest::SHA256.file(source_path).hexdigest
      unless after_load == before_load
        raise LoadError, "#{label} runtime source changed while the plugin was loading."
      end

      after_load.freeze
    end
  end
end
