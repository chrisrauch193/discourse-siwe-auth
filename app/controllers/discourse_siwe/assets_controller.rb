# frozen_string_literal: true

module DiscourseSiwe
  # Serves static AppKit JS. Uses Base so we never touch Discourse
  # ApplicationController (avoids load-time side effects during rake db:migrate).
  class AssetsController < ActionController::Base
    skip_before_action :verify_authenticity_token

    # Serve the AppKit bundle so loadScript() can fetch it.
    # Discourse does not serve plugin public/ by default; this fixes the 404.
    def appkit_bundle
      path = File.expand_path(
        "../../../public/javascripts/appkit-bundle.min.js",
        __dir__
      )
      if File.exist?(path)
        send_file path,
                  type: "application/javascript",
                  disposition: "inline",
                  filename: "appkit-bundle.min.js"
      else
        head :not_found
      end
    end
  end
end
