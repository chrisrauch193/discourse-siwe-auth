# frozen_string_literal: true

DiscourseSiwe::Engine.routes.draw do
  # Serve AppKit bundle when assets_controller exists (optional so clone-without-file still boots)
  assets_controller_path = File.expand_path("../../../app/controllers/discourse_siwe/assets_controller.rb", __FILE__)
  if File.exist?(assets_controller_path)
    get '/javascripts/appkit-bundle.min.js' => 'assets#appkit_bundle', format: false
  end

  # Public auth routes
  get '/auth' => 'auth#index'
  get '/message' => 'auth#message'
  get '/check-session' => 'auth#check_session'
  
  # Admin API routes for wallet management
  # These require admin authentication (via API key with admin scope)
  # Using scope instead of namespace to match DiscourseSiwe::AdminController
  scope '/admin', as: 'admin' do
    post '/link_wallet' => 'admin#link_wallet'
    delete '/unlink_wallet' => 'admin#unlink_wallet'
    get '/wallet_status' => 'admin#wallet_status'
    post '/bulk_link_wallets' => 'admin#bulk_link_wallets'
  end
end
