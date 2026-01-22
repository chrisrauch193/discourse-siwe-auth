# frozen_string_literal: true

DiscourseSiwe::Engine.routes.draw do
  # Public auth routes
  get '/auth' => 'auth#index'
  get '/message' => 'auth#message'
  get '/check-session' => 'auth#check_session'
  
  # Admin API routes for wallet management
  # These require admin authentication
  namespace :admin do
    post '/link_wallet' => 'admin#link_wallet'
    delete '/unlink_wallet' => 'admin#unlink_wallet'
    get '/wallet_status' => 'admin#wallet_status'
    post '/bulk_link_wallets' => 'admin#bulk_link_wallets'
  end
end
